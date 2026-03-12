import 'server-only'

const telegramToken = process.env.TELEGRAM_BOT_TOKEN

function getTelegramApiUrl(method: string) {
  if (!telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN fehlt.')
  }

  return `https://api.telegram.org/bot${telegramToken}/${method}`
}

export async function sendTelegramMessage(chatId: number | string, text: string) {
  const response = await fetch(getTelegramApiUrl('sendMessage'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Telegram sendMessage fehlgeschlagen: ${response.status} ${body}`)
  }

  return response.json()
}
