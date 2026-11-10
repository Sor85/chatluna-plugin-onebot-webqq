const defaultWebQQAccentColor = '#2563eb'

export function normalizeAccentColor(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : defaultWebQQAccentColor
}

function hexToRgba(color: string, opacity: number) {
  const normalized = normalizeAccentColor(color)
  const red = Number.parseInt(normalized.slice(1, 3), 16)
  const green = Number.parseInt(normalized.slice(3, 5), 16)
  const blue = Number.parseInt(normalized.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

export function getWebQQAccentStyle(accentColor: string) {
  return {
    '--onebot-webqq-webqq-accent': accentColor,
    '--onebot-webqq-webqq-accent-soft': hexToRgba(accentColor, 0.14),
    '--onebot-webqq-webqq-accent-hover': hexToRgba(accentColor, 0.18),
    '--onebot-webqq-webqq-accent-shadow': hexToRgba(accentColor, 0.24),
  }
}
