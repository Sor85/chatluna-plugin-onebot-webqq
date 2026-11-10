import * as React from 'react'
import { IconSearch } from '@tabler/icons-react'
import { useT } from '../../i18n'
import type { WebQQActionDialogSpec, WebQQConfirmDialogSpec, WebQQForwardTargetModel, WebQQForwardTargetOption } from '../controller'
import { readWebQQErrorMessage } from '../utils/webqq-error'
import { useWebQQScrollbar } from '../utils/webqq-scrollbar'
import {
  WebQQButton,
  WebQQDialog,
  WebQQDialogContent,
  WebQQDialogDescription,
  WebQQDialogFooter,
  WebQQDialogHeader,
  WebQQDialogTitle,
  WebQQInput,
} from '../ui'

/** 输入对话框：打开时用 spec 里的初值重置输入框；提交后由控制器先关闭再跑动作。 */
export function WebQQActionDialog(props: { spec?: WebQQActionDialogSpec, onOpenChange: (open: boolean) => void, onConfirm: (value: string) => void }) {
  const t = useT()
  const [spec, setSpec] = React.useState(props.spec)
  const [value, setValue] = React.useState(props.spec?.value ?? '')
  // 关闭时 spec 立即清空，保留最后一份内容播完退场动画。
  if (props.spec && props.spec !== spec) {
    setSpec(props.spec)
    setValue(props.spec.value ?? '')
  }
  const close = () => props.onOpenChange(false)
  const submit = () => props.onConfirm(value)
  return (
    <WebQQDialog open={!!props.spec} onOpenChange={props.onOpenChange}>
      <WebQQDialogContent onClose={close}>
        <WebQQDialogHeader>
          <WebQQDialogTitle>{spec?.title}</WebQQDialogTitle>
          {spec?.description ? <WebQQDialogDescription>{spec.description}</WebQQDialogDescription> : null}
        </WebQQDialogHeader>
        <WebQQInput
          value={value}
          placeholder={spec?.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        <WebQQDialogFooter>
          <WebQQButton variant="outline" onClick={close}>{t('webqq.common.cancel')}</WebQQButton>
          <WebQQButton onClick={submit}>{spec?.confirmText ?? t('webqq.common.save')}</WebQQButton>
        </WebQQDialogFooter>
      </WebQQDialogContent>
    </WebQQDialog>
  )
}

/** 确认对话框：自持提交态并等待这一轮动作；失败时保留对话框供重试，错误由观察窗的横幅展示。 */
export function WebQQConfirmDialog(props: { spec?: WebQQConfirmDialogSpec, onOpenChange: (open: boolean) => void, onConfirm: () => Promise<void> }) {
  const t = useT()
  const [spec, setSpec] = React.useState(props.spec)
  const [submitting, setSubmitting] = React.useState(false)
  if (props.spec && props.spec !== spec) {
    setSpec(props.spec)
    setSubmitting(false)
  }
  const confirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await props.onConfirm()
    } catch {
      // 失败时保留确认框，具体错误由观察窗统一展示。
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <WebQQDialog open={!!props.spec} onOpenChange={props.onOpenChange}>
      <WebQQDialogContent onClose={() => props.onOpenChange(false)}>
        <WebQQDialogHeader>
          <WebQQDialogTitle>{spec?.title}</WebQQDialogTitle>
          <WebQQDialogDescription>{spec?.description}</WebQQDialogDescription>
        </WebQQDialogHeader>
        <WebQQDialogFooter>
          <WebQQButton variant="outline" disabled={submitting} onClick={() => props.onOpenChange(false)}>{t('webqq.common.cancel')}</WebQQButton>
          <WebQQButton variant="destructive" disabled={submitting} onClick={() => void confirm()}>
            {submitting ? t('webqq.common.processing') : spec?.confirmText ?? t('webqq.common.confirm')}
          </WebQQButton>
        </WebQQDialogFooter>
      </WebQQDialogContent>
    </WebQQDialog>
  )
}

type ForwardTargetTab = 'recent' | 'friends' | 'groups'

/** 合并转发目标：最近、好友、群组三栏可搜索单选；失败信息留在弹窗里，不丢失多选。 */
export function WebQQForwardTargetDialog(props: { open: boolean, model: WebQQForwardTargetModel, onOpenChange: (open: boolean) => void, onConfirm: (target: WebQQForwardTargetOption) => Promise<void> }) {
  const t = useT()
  const { model } = props
  const [activeTab, setActiveTab] = React.useState<ForwardTargetTab>('recent')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedTargetId, setSelectedTargetId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState('')
  const scrollbar = useWebQQScrollbar<HTMLDivElement>({ tone: 'accent', zIndex: 10202 })
  const tabs: Array<{ id: ForwardTargetTab, label: string }> = [
    { id: 'recent', label: t('webqq.tabs.recent') },
    { id: 'friends', label: t('webqq.tabs.friends') },
    { id: 'groups', label: t('webqq.tabs.groups') },
  ]

  const visibleTargets = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const source = model[activeTab]
    if (!query) return source
    return source.filter((target) => target.title.toLowerCase().includes(query)
      || target.peerId.toLowerCase().includes(query)
      || (target.subtitle?.toLowerCase().includes(query) ?? false))
  }, [model, activeTab, searchQuery])

  const emptyText = searchQuery.trim()
    ? t('webqq.forwardTarget.noMatch')
    : activeTab === 'friends' ? t('webqq.forwardTarget.noFriends')
      : activeTab === 'groups' ? t('webqq.forwardTarget.noGroups') : t('webqq.contacts.emptyRecent')

  React.useEffect(() => {
    if (!props.open) return
    setActiveTab('recent')
    setSearchQuery('')
    setSelectedTargetId(model.recent[0]?.id ?? model.friends[0]?.id ?? model.groups[0]?.id ?? '')
    setSubmitting(false)
    setErrorMessage('')
  }, [props.open])

  // 切换分类或搜索后，当前选中项不在可见列表里时改选第一项。
  React.useEffect(() => {
    if (!visibleTargets.some(({ id }) => id === selectedTargetId)) setSelectedTargetId(visibleTargets[0]?.id ?? '')
  }, [activeTab, searchQuery])

  const confirm = async () => {
    const target = Object.values(model).flat().find(({ id }) => id === selectedTargetId)
    if (!target || submitting) return
    setSubmitting(true)
    setErrorMessage('')
    try {
      await props.onConfirm(target)
      props.onOpenChange(false)
    } catch (error) {
      // 多选态隐藏输入区，失败信息必须留在当前弹窗，用户才能直接重试而不丢失选择。
      setErrorMessage(readWebQQErrorMessage(error, t('webqq.forwardTarget.failed')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <WebQQDialog open={props.open} onOpenChange={props.onOpenChange}>
      <WebQQDialogContent className="onebot-webqq-webqq__forward-target-dialog" onClose={() => props.onOpenChange(false)}>
        <WebQQDialogHeader>
          <WebQQDialogTitle>{t('webqq.forwardTarget.title')}</WebQQDialogTitle>
          <WebQQDialogDescription>{t('webqq.forwardTarget.description')}</WebQQDialogDescription>
        </WebQQDialogHeader>
        <label className="onebot-webqq-webqq__forward-target-search">
          <IconSearch size={18} aria-hidden="true" />
          <input
            value={searchQuery}
            type="search"
            aria-label={t('webqq.forwardTarget.search')}
            placeholder={t('webqq.forwardTarget.searchPlaceholder')}
            autoComplete="off"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <div className="onebot-webqq-webqq__forward-target-tabs" role="tablist" aria-label={t('webqq.forwardTarget.tabs')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={['onebot-webqq-webqq__forward-target-tab', activeTab === tab.id ? 'is-active' : ''].filter(Boolean).join(' ')}
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div ref={scrollbar} className="onebot-webqq-webqq__forward-target-list" role="listbox" aria-label={t('webqq.forwardTarget.list')}>
          {visibleTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="option"
              className={['onebot-webqq-webqq__forward-target-item', selectedTargetId === target.id ? 'is-active' : ''].filter(Boolean).join(' ')}
              aria-selected={selectedTargetId === target.id}
              onClick={() => setSelectedTargetId(target.id)}
            >
              {target.avatar
                ? <img src={target.avatar} alt={target.title} />
                : <span className="onebot-webqq-webqq__forward-target-avatar-fallback" aria-hidden="true">{target.title.slice(0, 1)}</span>}
              <span className="onebot-webqq-webqq__forward-target-copy">
                <strong>{target.title}</strong>
                <small>{target.subtitle || target.peerId}</small>
              </span>
              <span className="onebot-webqq-webqq__forward-target-radio" aria-hidden="true"></span>
            </button>
          ))}
          {!visibleTargets.length ? <div className="onebot-webqq-webqq__forward-target-empty">{emptyText}</div> : null}
        </div>
        {errorMessage ? <p className="onebot-webqq-webqq__forward-target-error" role="alert">{errorMessage}</p> : null}
        <WebQQDialogFooter>
          <WebQQButton variant="outline" disabled={submitting} onClick={() => props.onOpenChange(false)}>{t('webqq.common.cancel')}</WebQQButton>
          <WebQQButton disabled={!selectedTargetId || submitting} onClick={() => void confirm()}>
            {submitting ? t('webqq.forwardTarget.sending') : t('webqq.forwardTarget.submit')}
          </WebQQButton>
        </WebQQDialogFooter>
      </WebQQDialogContent>
    </WebQQDialog>
  )
}
