import * as React from 'react'
import { IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight, IconSearch, IconX } from '@tabler/icons-react'
import { useT } from '../../i18n'
import { useStore } from '../../shared/store'
import { config } from '../../runtime'
import type { WebQQController, WebQQState } from '../controller'
import { showWebQQPopover } from '../utils/webqq-popover'
import { useWebQQScrollbar } from '../utils/webqq-scrollbar'

interface CalendarDay {
  key: string
  day: number
  localDate: string
  date: Date
  inCurrentMonth: boolean
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function toLocalDate(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** 查找聊天记录：标题栏里展开的搜索框，输入防抖查找，可按日期筛选，结果点击后跳到那条消息。 */
export function WebQQMessageSearchPage(props: { c: WebQQController, s: WebQQState }) {
  const { c, s } = props
  const t = useT()
  const frosted = useStore(config).enableWebQQFrostedGlass
  const searchRoot = React.useRef<HTMLElement>(null)
  const searchInput = React.useRef<HTMLInputElement>(null)
  const datePopover = React.useRef<HTMLDivElement>(null)
  const [datePopoverStyle, setDatePopoverStyle] = React.useState<React.CSSProperties>({})
  const [datePopoverOpen, setDatePopoverOpen] = React.useState(false)
  const [monthMenuOpen, setMonthMenuOpen] = React.useState(false)
  const [yearMenuOpen, setYearMenuOpen] = React.useState(false)
  const [searchFocused, setSearchFocused] = React.useState(false)
  const now = React.useMemo(() => new Date(), [])
  const [displayYear, setDisplayYear] = React.useState(now.getFullYear())
  const [displayMonth, setDisplayMonth] = React.useState(now.getMonth() + 1)
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const resultsScrollbar = useWebQQScrollbar<HTMLDivElement>({ tone: 'accent' })
  const monthScrollbar = useWebQQScrollbar<HTMLDivElement>()
  const yearScrollbar = useWebQQScrollbar<HTMLDivElement>()
  const query = s.messageSearchQuery
  const localDate = s.messageSearchLocalDate
  const todayLocalDate = toLocalDate(now)
  const yearOptions = Array.from({ length: 10 }, (_, index) => now.getFullYear() - index)
  const weekdays = t('webqq.search.weekdays').split(',')
  const hasCriteria = !!query.trim() || !!localDate
  const statusText = s.messageSearchErrorText
    || (s.messageSearchLoading && !s.messageSearchResults.length ? t('webqq.search.searching') : '')
    || (s.messageSearchSearched && !s.messageSearchLoading && !s.messageSearchResults.length ? t('webqq.search.noMatch') : '')

  const calendarDays = React.useMemo<CalendarDay[]>(() => {
    const firstDay = new Date(displayYear, displayMonth - 1, 1)
    const mondayOffset = (firstDay.getDay() + 6) % 7
    const gridStart = new Date(displayYear, displayMonth - 1, 1 - mondayOffset)
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart)
      date.setDate(gridStart.getDate() + index)
      const value = toLocalDate(date)
      return {
        key: value,
        day: date.getDate(),
        localDate: value,
        date,
        inCurrentMonth: date.getFullYear() === displayYear && date.getMonth() + 1 === displayMonth,
      }
    })
  }, [displayYear, displayMonth])

  React.useEffect(() => {
    const parsed = parseLocalDate(localDate)
    if (!parsed) return
    setDisplayYear(parsed.getFullYear())
    setDisplayMonth(parsed.getMonth() + 1)
  }, [localDate])

  const updateDatePopoverPosition = React.useCallback(() => {
    const anchor = searchRoot.current?.getBoundingClientRect()
    if (!anchor) return
    const width = Math.min(250, window.innerWidth - 24)
    const left = Math.min(Math.max(12, anchor.right - width), window.innerWidth - width - 12)
    setDatePopoverStyle({ top: `${anchor.bottom + 10}px`, left: `${left}px`, right: 'auto', width: `${width}px` })
  }, [])

  React.useLayoutEffect(() => {
    if (!datePopoverOpen) {
      setMonthMenuOpen(false)
      setYearMenuOpen(false)
      return
    }
    updateDatePopoverPosition()
    showWebQQPopover(datePopover.current)
  }, [datePopoverOpen, updateDatePopoverPosition])

  React.useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && searchRoot.current?.contains(event.target)) return
      c.closeMessageSearch()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('resize', updateDatePopoverPosition)
    // 展开动画期间外壳还是 32px，默认 focus 会 scrollIntoView，把 overflow 窗口整块推走。
    requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }))
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('resize', updateDatePopoverPosition)
      clearTimeout(debounceTimer.current)
    }
  }, [c, updateDatePopoverPosition])

  const handleQueryInput = (value: string) => {
    c.setMessageSearchQuery(value)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => c.searchMessages({
      query: value.trim(),
      ...(localDate ? { localDate } : {}),
    }), value.trim() ? 250 : 0)
  }

  const clearQuery = () => {
    c.setMessageSearchQuery('')
    c.searchMessages({ query: '', ...(localDate ? { localDate } : {}) })
    requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }))
  }

  const handleEscape = () => {
    if (monthMenuOpen || yearMenuOpen) {
      setMonthMenuOpen(false)
      setYearMenuOpen(false)
      return
    }
    if (datePopoverOpen) {
      setDatePopoverOpen(false)
      return
    }
    c.closeMessageSearch()
  }

  const shiftMonth = (offset: number) => {
    const next = new Date(displayYear, displayMonth - 1 + offset, 1)
    setDisplayYear(next.getFullYear())
    setDisplayMonth(next.getMonth() + 1)
    setMonthMenuOpen(false)
    setYearMenuOpen(false)
  }

  const selectDate = (value: string) => {
    c.setMessageSearchLocalDate(value)
    c.searchMessages({ query: query.trim(), localDate: value })
    setDatePopoverOpen(false)
  }

  const formatSearchTime = (time: number) => new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time))

  return (
    <section ref={searchRoot} className="onebot-webqq-webqq__message-search" role="search" aria-label={t('webqq.search.title')}>
      <div
        className={['onebot-webqq-webqq__message-search-field', searchFocused ? 'is-focused' : ''].filter(Boolean).join(' ')}
        onFocus={() => setSearchFocused(true)}
        onBlur={(event) => {
          // 显式状态类用于触发稳定的样式重算，避免同页其他插件存在同名 :focus-within 规则时沿用未聚焦的初始计算结果。
          const nextTarget = event.relatedTarget
          setSearchFocused(nextTarget instanceof Node && event.currentTarget.contains(nextTarget))
        }}
      >
        <IconSearch size={18} aria-hidden="true" />
        <input
          ref={searchInput}
          value={query}
          type="search"
          aria-label={t('webqq.search.input')}
          placeholder={t('webqq.search.placeholder')}
          autoComplete="off"
          onChange={(event) => handleQueryInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.nativeEvent.stopPropagation()
            handleEscape()
          }}
        />
        <button
          type="button"
          className={['onebot-webqq-webqq__message-search-date-trigger', localDate ? 'is-active' : ''].filter(Boolean).join(' ')}
          aria-label={localDate ? t('webqq.search.dateActive', { date: localDate }) : t('webqq.search.date')}
          aria-pressed={!!localDate}
          onClick={(event) => {
            event.stopPropagation()
            setDatePopoverOpen((open) => !open)
          }}
        >
          <IconCalendar size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="onebot-webqq-webqq__message-search-clear"
          aria-label={query ? t('webqq.search.clear') : t('webqq.search.close')}
          onClick={() => query ? clearQuery() : c.closeMessageSearch()}
        >
          <IconX size={16} aria-hidden="true" />
        </button>
      </div>

      {datePopoverOpen ? (
        <div
          ref={datePopover}
          popover="manual"
          className={['onebot-webqq-webqq__message-search-date-popover', frosted ? 'is-frosted' : 'is-plain'].join(' ')}
          style={datePopoverStyle}
          data-onebot-webqq-message-search-date=""
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="onebot-webqq-webqq__message-search-calendar-header">
            <button type="button" aria-label={t('webqq.search.prevMonth')} onClick={() => shiftMonth(-1)}>
              <IconChevronLeft size={16} aria-hidden="true" />
            </button>
            <div className="onebot-webqq-webqq__message-search-calendar-selectors">
              <button
                type="button"
                aria-expanded={monthMenuOpen}
                onClick={() => {
                  setMonthMenuOpen((open) => !open)
                  setYearMenuOpen(false)
                }}
              >
                {t('webqq.search.month', { month: displayMonth })}
                <IconChevronDown size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-expanded={yearMenuOpen}
                onClick={() => {
                  setYearMenuOpen((open) => !open)
                  setMonthMenuOpen(false)
                }}
              >
                {t('webqq.search.year', { year: displayYear })}
                <IconChevronDown size={16} aria-hidden="true" />
              </button>
            </div>
            <button type="button" aria-label={t('webqq.search.nextMonth')} onClick={() => shiftMonth(1)}>
              <IconChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          {monthMenuOpen ? (
            <div ref={monthScrollbar} className="onebot-webqq-webqq__message-search-calendar-menu is-month" role="listbox" aria-label={t('webqq.search.chooseMonth')}>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                <button
                  key={month}
                  type="button"
                  role="option"
                  aria-selected={month === displayMonth}
                  className={month === displayMonth ? 'is-selected' : undefined}
                  onClick={() => {
                    setDisplayMonth(month)
                    setMonthMenuOpen(false)
                  }}
                >
                  {t('webqq.search.month', { month })}
                </button>
              ))}
            </div>
          ) : null}
          {yearMenuOpen ? (
            <div ref={yearScrollbar} className="onebot-webqq-webqq__message-search-calendar-menu is-year" role="listbox" aria-label={t('webqq.search.chooseYear')}>
              {yearOptions.map((year) => (
                <button
                  key={year}
                  type="button"
                  role="option"
                  aria-selected={year === displayYear}
                  className={year === displayYear ? 'is-selected' : undefined}
                  onClick={() => {
                    setDisplayYear(year)
                    setYearMenuOpen(false)
                  }}
                >
                  {t('webqq.search.year', { year })}
                </button>
              ))}
            </div>
          ) : null}

          <div className="onebot-webqq-webqq__message-search-calendar-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="onebot-webqq-webqq__message-search-calendar-grid" role="grid" aria-label={t('webqq.search.chooseDate')}>
            {calendarDays.map((day) => (
              <button
                key={day.key}
                type="button"
                role="gridcell"
                className={[
                  !day.inCurrentMonth ? 'is-outside' : '',
                  day.localDate === todayLocalDate ? 'is-today' : '',
                  day.localDate === localDate ? 'is-selected' : '',
                ].filter(Boolean).join(' ') || undefined}
                aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(day.date)}
                aria-selected={day.localDate === localDate}
                onClick={() => selectDate(day.localDate)}
              >
                {day.day}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {hasCriteria ? (
        <div ref={resultsScrollbar} className="onebot-webqq-webqq__message-search-results" role="listbox" aria-label={t('webqq.search.results')}>
          {statusText ? <p className="onebot-webqq-webqq__message-search-status" role="status" aria-live="polite">{statusText}</p> : null}
          {s.messageSearchResults.map((message) => (
            <button
              key={message.id || message.sequence}
              type="button"
              role="option"
              className="onebot-webqq-webqq__message-search-hit"
              aria-selected={false}
              onClick={() => void c.selectSearchResult(message)}
            >
              {message.senderAvatar
                ? <img className="onebot-webqq-webqq__message-search-avatar" src={message.senderAvatar} alt="" />
                : <span className="onebot-webqq-webqq__message-search-avatar is-fallback" aria-hidden="true">{message.senderName.slice(0, 1)}</span>}
              <span className="onebot-webqq-webqq__message-search-hit-body">
                <span className="onebot-webqq-webqq__message-search-hit-meta">
                  <strong>{message.senderName}</strong>
                  <time dateTime={new Date(message.time).toISOString()}>{formatSearchTime(message.time)}</time>
                </span>
                <span className="onebot-webqq-webqq__message-search-hit-summary">{message.summary || '[消息]'}</span>
              </span>
            </button>
          ))}
          {s.messageSearchSearched && !s.messageSearchExhausted && s.messageSearchResults.length ? (
            <button type="button" className="onebot-webqq-webqq__message-search-more" disabled={s.messageSearchLoading} onClick={c.searchMoreMessages}>
              {s.messageSearchLoading ? t('webqq.chat.loadingMore') : t('webqq.search.more')}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
