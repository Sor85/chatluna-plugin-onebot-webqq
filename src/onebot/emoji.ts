// 表情回应的表情类型判据。
//
// NapCat 的 fetch_emoji_like 要求调用方显式给出 emojiType，但它自己的 set_msg_emoji_like 不收这个字段，
// 而是在 core 内部按 emojiId 长度推导（napcat-core/apis/msg.ts 的 setEmojiLike：
// `emojiId.length > 3 ? '2' : '1'`）。这里复用同一条判据，保证「贴表情」和「查谁贴了」落在同一个
// 表情类型上；换成别的规则会出现表情贴得上、回应人却查不到的情况。
//
// 取值语义：1 表示 QQ 小黄脸表情（qface QSid，最多 3 位）；2 表示 Unicode 码点十进制值（至少 4 位，
// 例如 ❤ 的 10084 与 👍 的 128077）。LLBot 的 fetch_emoji_like 不声明这个字段，多传会被它的
// Schema 丢弃，因此两种实现共用一份参数即可。
export const oneBotFaceEmojiType = 1
export const oneBotUnicodeEmojiType = 2

export function resolveOneBotEmojiType(emojiId: string) {
  return String(emojiId).trim().length > 3 ? oneBotUnicodeEmojiType : oneBotFaceEmojiType
}
