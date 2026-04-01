import { NextRequest, NextResponse } from 'next/server'

import { createTelegramAvailabilityMessage } from '@/lib/availability-response'
import { parseAvailabilityMessage } from '@/lib/availability-message-parser'
import { checkAvailability, loadLocations } from '@/lib/availability-service'
import { sendTelegramDocument, sendTelegramMessage } from '@/lib/telegram'
import { handleTelegramWorkflowMessage } from '@/lib/telegram-workflow'

type TelegramWebhookBody = {
  message?: {
    message_id: number
    text?: string
    chat?: {
      id: number
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as TelegramWebhookBody
    const text = body.message?.text?.trim()
    const chatId = body.message?.chat?.id

    if (!chatId) {
      return NextResponse.json({ ok: true, ignored: 'missing-chat-id' })
    }

    if (!text) {
      await sendTelegramMessage(
        chatId,
        'Bitte sende eine Textnachricht wie: Ist von heute bis Donnerstag 5 Betten in Berlin frei?',
      )
      return NextResponse.json({ ok: true, ignored: 'missing-text' })
    }

    try {
      const workflowResult = await handleTelegramWorkflowMessage(chatId, text)
      if (workflowResult.handled) {
        await sendTelegramMessage(chatId, workflowResult.reply)
        if (workflowResult.document) {
          await sendTelegramDocument({
            chatId,
            fileName: workflowResult.document.fileName,
            contentType: workflowResult.document.contentType,
            data: workflowResult.document.data,
            caption: workflowResult.document.caption,
          })
        }
        return NextResponse.json({ ok: true, workflow: true })
      }

      const locations = await loadLocations()
      const parsedRequest = parseAvailabilityMessage(text, locations)
      const result = await checkAvailability(parsedRequest)
      const reply = createTelegramAvailabilityMessage(result, parsedRequest)

      await sendTelegramMessage(chatId, reply)

      return NextResponse.json({
        ok: true,
        request: parsedRequest,
        summary: reply,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
      console.error('Telegram webhook inner error:', error)
      await sendTelegramMessage(
        chatId,
        `Ich konnte die Anfrage nicht sicher auswerten. ${message}`,
      )

      return NextResponse.json({ ok: true, handledError: message })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    console.error('Telegram webhook outer error:', error)
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
