import type { createOneBotWebQQService } from './onebot/service'

// register / console / live-runtime 共用 service 形状。只有一份实现，因此不再是联合类型：
// 「两份实现必须同构」这条约束漏改不会报错，只会在某天表现成「模拟环境好用、真机不对」。
export type WebQQService = ReturnType<typeof createOneBotWebQQService>
