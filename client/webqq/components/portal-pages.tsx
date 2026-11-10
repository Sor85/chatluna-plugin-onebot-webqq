import * as React from 'react'
import { createPortal } from 'react-dom'
import { IconCamera, IconCheck, IconChevronDown, IconPencil, IconX } from '@tabler/icons-react'
import { useT } from '../../i18n'
import { useStore } from '../../shared/store'
import { config } from '../../runtime'
import type { WebQQSelfProfileUpdate } from '../types'
import {
  getCommonWebQQEmojiFaces,
  getWebQQEmojiFace,
  loadRecentWebQQEmojiIds,
  rememberWebQQEmojiId,
  searchWebQQEmojiFaces,
  type WebQQEmojiFace,
} from '../utils/emoji-catalog'
import {
  clampFloatingPanelPosition,
  createFloatingPanelEscapeHandler,
  getFloatingPanelStyle,
  isFloatingPanelInteractiveTarget,
} from '../utils/floating-panel'
import { groupProfileCardFields, type ProfileCardEditableField, type ProfileCardModel } from '../utils/profile-card'
import { showWebQQPopover } from '../utils/webqq-popover'
import { useResolvedColorMode, WebQQInput } from '../ui'

/**
 * 门户页（资料卡、贴表情）的共用机制：挂到 body 并提升到 Top Layer，在最近一次右键或点击的位置打开，
 * 标题栏可拖动，点外面关闭，Escape 退掉最上层（资料卡先退字段编辑，再关面板）。
 */
function usePortalPage(options: { size: { width?: number, height: number }, onClose: () => void, onEscape?: () => boolean, onOutsidePointer?: (target: Node) => void }) {
  const panel = React.useRef<HTMLElement>(null)
  const [style, setStyle] = React.useState<Record<string, string>>(() => getFloatingPanelStyle(options.size))
  const [dragging, setDragging] = React.useState(false)
  const drag = React.useRef<{ pointerId: number, startX: number, startY: number, left: number, top: number }>(undefined)
  const latest = React.useRef(options)
  latest.current = options

  React.useLayoutEffect(() => {
    showWebQQPopover(panel.current)
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      latest.current.onOutsidePointer?.(target)
      if (panel.current?.contains(target)) return
      latest.current.onClose()
    }
    const onEscape = createFloatingPanelEscapeHandler({
      isOpen: () => true,
      dismiss: () => {
        if (latest.current.onEscape?.()) return
        latest.current.onClose()
      },
    })
    const moveDrag = (event: PointerEvent) => {
      const state = drag.current
      const element = panel.current
      if (!state || event.pointerId !== state.pointerId || !element) return
      const position = clampFloatingPanelPosition({
        x: state.left + event.clientX - state.startX,
        y: state.top + event.clientY - state.startY,
      }, { width: window.innerWidth, height: window.innerHeight }, { width: element.offsetWidth, height: element.offsetHeight })
      setStyle({ left: `${position.x}px`, top: `${position.y}px` })
    }
    const stopDrag = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return
      drag.current = undefined
      setDragging(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', onEscape)
    document.addEventListener('pointermove', moveDrag)
    document.addEventListener('pointerup', stopDrag)
    document.addEventListener('pointercancel', stopDrag)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', onEscape)
      document.removeEventListener('pointermove', moveDrag)
      document.removeEventListener('pointerup', stopDrag)
      document.removeEventListener('pointercancel', stopDrag)
    }
  }, [])

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isFloatingPanelInteractiveTarget(event.target) || !panel.current) return
    const rect = panel.current.getBoundingClientRect()
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  return { panel, style, dragging, startDrag }
}

function usePortalPageClass(name: string) {
  const frosted = useStore(config).enableWebQQFrostedGlass
  const colorMode = useResolvedColorMode()
  return ['onebot-webqq-webqq__secondary-page onebot-webqq-webqq__portal-page', name, frosted ? 'is-frosted' : 'is-plain', `is-color-${colorMode}`].join(' ')
}

type SavingField = ProfileCardEditableField | 'avatar'

function readImageFile(file: File, failure: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(failure)))
    reader.addEventListener('error', () => reject(reader.error || new Error(failure)))
    reader.readAsDataURL(file)
  })
}

/** 查看资料：自己的资料在协议支持时可以就地编辑昵称、性别、签名并更换头像。 */
export function WebQQProfileCard(props: { model: ProfileCardModel, onClose: () => void, onSave: (input: WebQQSelfProfileUpdate) => Promise<boolean> }) {
  const { model } = props
  const t = useT()
  const [editingField, setEditingField] = React.useState<ProfileCardEditableField>()
  const [editValue, setEditValue] = React.useState('')
  const [savingField, setSavingField] = React.useState<SavingField>()
  const [avatarPreview, setAvatarPreview] = React.useState('')
  const [sexSelectOpen, setSexSelectOpen] = React.useState(false)
  const avatarInput = React.useRef<HTMLInputElement>(null)
  const sexSelect = React.useRef<HTMLDivElement>(null)
  const editingRef = React.useRef(editingField)
  editingRef.current = editingField
  const savingRef = React.useRef(savingField)
  savingRef.current = savingField
  const sexOptions = [
    { value: 'male', label: t('webqq.profile.sex.male') },
    { value: 'female', label: t('webqq.profile.sex.female') },
    { value: 'unknown', label: t('webqq.profile.sex.unknown') },
  ]

  const cancelFieldEdit = () => {
    if (savingRef.current) return
    setEditingField(undefined)
    setEditValue('')
    setSexSelectOpen(false)
  }

  const page = usePortalPage({
    size: { width: 300, height: 420 },
    onClose: props.onClose,
    // 字段编辑是资料卡的内层：焦点不在编辑框里时按 Escape 也先退出编辑，再按一次才关整张卡。
    onEscape: () => {
      if (!editingRef.current) return false
      cancelFieldEdit()
      return true
    },
    onOutsidePointer: (target) => {
      if (sexSelect.current && !sexSelect.current.contains(target)) setSexSelectOpen(false)
    },
  })
  const className = usePortalPageClass('onebot-webqq-webqq__profile-card-page')

  // 资料刷新后清掉本地头像预览；正在编辑的字段不再可编辑时退出编辑。
  React.useEffect(() => {
    setAvatarPreview('')
    if (editingRef.current && !model.fields.some((field) => field.editKey === editingRef.current)) {
      setEditingField(undefined)
      setEditValue('')
    }
  }, [model])

  const sections = groupProfileCardFields(model.fields)
  const displayAvatar = avatarPreview || model.avatar || ''

  const save = async (field: SavingField, input: WebQQSelfProfileUpdate) => {
    setSavingField(field)
    const success = await props.onSave(input).catch(() => false)
    setSavingField(undefined)
    return success
  }

  const handleAvatarFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file || !file.type.startsWith('image/') || !model.canEditAvatar || savingField) return
    try {
      const dataUrl = await readImageFile(file, t('webqq.profile.avatarReadFailed'))
      const separator = dataUrl.indexOf(',')
      if (separator < 0) return
      setAvatarPreview(dataUrl)
      // OneBot set_qq_avatar 接收 base64://；预览仍使用浏览器可渲染的 data URL，避免把协议格式塞进 img src。
      if (!await save('avatar', { avatar: `base64://${dataUrl.slice(separator + 1)}` })) setAvatarPreview('')
    } catch {
      setAvatarPreview('')
      setSavingField(undefined)
    }
  }

  const startFieldEdit = (field: ProfileCardEditableField) => {
    if (!model.canEditSelf || savingField) return
    setEditingField(field)
    setEditValue(field === 'nickname' ? model.nickname || model.name || '' : field === 'personalNote' ? model.personalNote || '' : model.sex || 'unknown')
    setSexSelectOpen(false)
  }

  const saveFieldEdit = async (field: ProfileCardEditableField) => {
    if (editingField !== field || !model.canEditSelf || savingField) return
    const input: WebQQSelfProfileUpdate = {}
    if (field === 'nickname') {
      const nickname = editValue.trim()
      if (!nickname) return
      if (nickname === (model.nickname || model.name)) return cancelFieldEdit()
      input.nickname = nickname
    } else if (field === 'personalNote') {
      if (editValue === (model.personalNote || '')) return cancelFieldEdit()
      input.personalNote = editValue
    } else {
      if (editValue === (model.sex || '')) return cancelFieldEdit()
      input.sex = editValue
    }
    if (!await save(field, input)) return
    setEditingField(undefined)
    setEditValue('')
  }

  const avatarImage = (src: string) => src
    ? <img className="onebot-webqq-webqq__profile-card-avatar" src={src} alt={model.name} />
    : <span className="onebot-webqq-webqq__profile-card-avatar is-fallback" aria-hidden="true">{model.name.slice(0, 1)}</span>

  return createPortal(
    <section ref={page.panel} popover="manual" className={className} style={page.style} aria-label={t('webqq.menu.viewProfile')}>
      <header className={['onebot-webqq-webqq__secondary-page-header', page.dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')} onPointerDown={page.startDrag}>
        <strong>{t('webqq.menu.viewProfile')}</strong>
      </header>
      <div className="onebot-webqq-webqq__profile-card">
        <div className="onebot-webqq-webqq__profile-card-hero">
          {model.canEditAvatar ? (
            <button
              type="button"
              className="onebot-webqq-webqq__profile-card-avatar-button"
              disabled={savingField != null}
              aria-label={t('webqq.profile.changeAvatar')}
              onClick={() => avatarInput.current?.click()}
            >
              <span className="onebot-webqq-webqq__profile-card-avatar-frame">
                {avatarImage(displayAvatar)}
                <span className="onebot-webqq-webqq__profile-card-avatar-overlay" aria-hidden="true"><IconCamera size={22} /></span>
              </span>
              <span className="onebot-webqq-webqq__profile-card-avatar-hint">{savingField === 'avatar' ? t('webqq.profile.changingAvatar') : t('webqq.profile.changeAvatar')}</span>
            </button>
          ) : (
            <span className="onebot-webqq-webqq__profile-card-avatar-frame is-static">{avatarImage(model.avatar || '')}</span>
          )}
          <input ref={avatarInput} className="onebot-webqq-webqq__profile-card-avatar-input" type="file" accept="image/*" tabIndex={-1} onChange={(event) => void handleAvatarFileSelect(event)} />
        </div>
        {sections.map((section) => (
          <section key={section.group} className="onebot-webqq-webqq__profile-card-section">
            <h3>{section.label}</h3>
            <dl className="onebot-webqq-webqq__profile-card-fields">
              {section.fields.map((field) => {
                const editing = !!field.editKey && editingField === field.editKey
                const editKey = field.editKey
                return (
                  <div key={`${section.group}:${field.label}`} className={editing ? 'is-editing' : undefined}>
                    <dt>{field.label}</dt>
                    {editing && editKey ? (
                      <dd className="onebot-webqq-webqq__profile-card-field-editor">
                        {editKey === 'sex' ? (
                          <div ref={sexSelect} className={['onebot-webqq-webqq__profile-card-select', sexSelectOpen ? 'is-open' : ''].filter(Boolean).join(' ')}>
                            <button
                              type="button"
                              className="onebot-webqq-webqq__profile-card-select-trigger"
                              disabled={savingField != null}
                              aria-haspopup="listbox"
                              aria-expanded={sexSelectOpen}
                              aria-label={t('webqq.profile.editSex')}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (!savingField) setSexSelectOpen((open) => !open)
                              }}
                            >
                              <span>{sexOptions.find((option) => option.value === editValue)?.label || t('webqq.profile.sex.unknown')}</span>
                              <IconChevronDown size={16} aria-hidden="true" />
                            </button>
                            {sexSelectOpen ? (
                              <div className="onebot-webqq-webqq__profile-card-select-menu" role="listbox" aria-label={t('webqq.profile.sexOptions')}>
                                {sexOptions.map((option) => (
                                  <button
                                    key={option.value}
                                    type="button"
                                    className={['onebot-webqq-webqq__profile-card-select-option', editValue === option.value ? 'is-active' : ''].filter(Boolean).join(' ')}
                                    role="option"
                                    aria-selected={editValue === option.value}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      setEditValue(option.value)
                                      setSexSelectOpen(false)
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <WebQQInput
                            value={editValue}
                            aria-label={t('webqq.profile.editField', { label: field.label })}
                            placeholder={editKey === 'nickname' ? t('webqq.profile.nicknamePlaceholder') : t('webqq.profile.notePlaceholder')}
                            onChange={(event) => setEditValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void saveFieldEdit(editKey)
                              if (event.key === 'Escape') {
                                // 编辑框里的这一下只属于内层：必须拦住，否则冒到 document 时面板会跟着一起关。
                                event.nativeEvent.stopPropagation()
                                event.stopPropagation()
                                cancelFieldEdit()
                              }
                            }}
                          />
                        )}
                      </dd>
                    ) : (
                      <dd className={!field.value ? 'is-empty' : undefined}>{field.value || t('webqq.profile.unset')}</dd>
                    )}
                    {editKey ? (
                      <span className="onebot-webqq-webqq__profile-card-field-actions">
                        {editing ? (
                          <>
                            <button type="button" className="onebot-webqq-webqq__profile-card-field-action" disabled={savingField != null} aria-label={t('webqq.profile.cancelEdit', { label: field.label })} onClick={cancelFieldEdit}>
                              <IconX size={16} />
                            </button>
                            <button
                              type="button"
                              className="onebot-webqq-webqq__profile-card-field-action is-confirm"
                              disabled={savingField != null || (editKey === 'nickname' && !editValue.trim())}
                              aria-label={t('webqq.profile.saveField', { label: field.label })}
                              onClick={() => void saveFieldEdit(editKey)}
                            >
                              <IconCheck size={16} />
                            </button>
                          </>
                        ) : (
                          <button type="button" className="onebot-webqq-webqq__profile-card-field-action" disabled={savingField != null} aria-label={t('webqq.profile.editField', { label: field.label })} onClick={() => startFieldEdit(editKey)}>
                            <IconPencil size={16} />
                          </button>
                        )}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </dl>
          </section>
        ))}
      </div>
    </section>,
    document.body,
  )
}

/** 贴表情：常用（最近用过的）、推荐与全部表情，可按名称、拼音或 ID 搜索。没有内部层，Escape 直接关面板。 */
export function WebQQEmojiPicker(props: { onClose: () => void, onSelect: (emojiId: string) => void }) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [recentIds, setRecentIds] = React.useState(loadRecentWebQQEmojiIds)
  const page = usePortalPage({ size: { height: 520 }, onClose: props.onClose })
  const className = usePortalPageClass('onebot-webqq-webqq__emoji-picker-page')
  const commonFaces = React.useMemo(() => getCommonWebQQEmojiFaces(), [])
  const recentFaces = recentIds.map((id) => getWebQQEmojiFace(id)).filter((face): face is WebQQEmojiFace => !!face)
  const visibleFaces = React.useMemo(() => searchWebQQEmojiFaces(query), [query])
  const searching = !!query.trim()

  const select = (emojiId: string) => {
    setRecentIds(rememberWebQQEmojiId(emojiId))
    props.onSelect(emojiId)
    props.onClose()
  }

  const grid = (faces: WebQQEmojiFace[], prefix: string) => faces.map((face) => (
    <button key={`${prefix}${face.id}`} type="button" className="onebot-webqq-webqq__emoji-picker-item" title={face.label} onClick={() => select(face.id)}>
      {face.url ? <img src={face.url} alt={face.label} /> : <span>{face.label}</span>}
    </button>
  ))

  return createPortal(
    <section ref={page.panel} popover="manual" className={className} style={page.style} aria-label={t('webqq.message.react')}>
      <header className={['onebot-webqq-webqq__secondary-page-header', page.dragging ? 'is-dragging' : ''].filter(Boolean).join(' ')} onPointerDown={page.startDrag}>
        <strong>{t('webqq.message.react')}</strong>
      </header>
      <div className="onebot-webqq-webqq__emoji-picker">
        <WebQQInput
          value={query}
          className="onebot-webqq-webqq__emoji-picker-search"
          type="search"
          placeholder={t('webqq.emoji.searchPlaceholder')}
          aria-label={t('webqq.emoji.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {!searching && recentFaces.length ? (
          <section className="onebot-webqq-webqq__emoji-picker-section">
            <header>{t('webqq.emoji.recent')}</header>
            <div className="onebot-webqq-webqq__emoji-picker-grid">{grid(recentFaces, 'recent:')}</div>
          </section>
        ) : null}
        {!searching ? (
          <section className="onebot-webqq-webqq__emoji-picker-section">
            <header>{t('webqq.emoji.common')}</header>
            <div className="onebot-webqq-webqq__emoji-picker-grid">{grid(commonFaces, 'common:')}</div>
          </section>
        ) : null}
        <section className="onebot-webqq-webqq__emoji-picker-section">
          <header>{searching ? t('webqq.emoji.results') : t('webqq.emoji.all')}</header>
          <div className="onebot-webqq-webqq__emoji-picker-grid">
            {grid(visibleFaces, '')}
            {!visibleFaces.length ? <p className="onebot-webqq-webqq__emoji-picker-empty">{t('webqq.emoji.noMatch')}</p> : null}
          </div>
        </section>
      </div>
    </section>,
    document.body,
  )
}
