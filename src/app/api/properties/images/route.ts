import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  PROPERTY_IMAGE_MAX_SIZE_BYTES,
  PROPERTY_MEDIA_BUCKET,
} from '@/lib/property-media'

async function ensurePropertyMediaBucket() {
  const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets()

  if (listError) {
    throw new Error(listError.message)
  }

  const existing = buckets.find(bucket => bucket.id === PROPERTY_MEDIA_BUCKET)
  if (existing) {
    return
  }

  const { error: createError } = await supabaseAdmin.storage.createBucket(PROPERTY_MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: PROPERTY_IMAGE_MAX_SIZE_BYTES,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  })

  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(createError.message)
  }
}

function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, '-')
    .replace(/-+/g, '-')
}

async function requireUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return { error: NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 }) }
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    return { error: NextResponse.json({ error: 'Session ist ungueltig.' }, { status: 401 }) }
  }

  return { user }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request)
    if ('error' in auth) {
      return auth.error
    }

    await ensurePropertyMediaBucket()

    const formData = await request.formData()
    const propertyId = String(formData.get('propertyId') ?? '').trim()
    const file = formData.get('file')

    if (!propertyId) {
      return NextResponse.json({ error: 'Objekt-ID fehlt.' }, { status: 400 })
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Datei fehlt.' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Nur Bilddateien sind erlaubt.' }, { status: 400 })
    }

    if (file.size > PROPERTY_IMAGE_MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'Die Datei ist zu gross.' }, { status: 400 })
    }

    const { data: property } = await supabaseAdmin
      .from('properties')
      .select('id')
      .eq('id', propertyId)
      .maybeSingle()

    if (!property) {
      return NextResponse.json({ error: 'Objekt wurde nicht gefunden.' }, { status: 404 })
    }

    const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
    const safeName = sanitizeFilename(file.name.replace(/\.[^.]+$/, '')) || 'bild'
    const path = `${propertyId}/${Date.now()}-${crypto.randomUUID()}-${safeName}.${extension}`
    const arrayBuffer = await file.arrayBuffer()

    const { error: uploadError } = await supabaseAdmin.storage
      .from(PROPERTY_MEDIA_BUCKET)
      .upload(path, arrayBuffer, {
        contentType: file.type,
        upsert: false,
        cacheControl: '3600',
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }

    const { data } = supabaseAdmin.storage
      .from(PROPERTY_MEDIA_BUCKET)
      .getPublicUrl(path)

    return NextResponse.json({
      ok: true,
      path,
      publicUrl: data.publicUrl,
      fileName: file.name,
      uploadedBy: auth.user.id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireUser(request)
    if ('error' in auth) {
      return auth.error
    }

    await ensurePropertyMediaBucket()

    const body = await request.json() as { paths?: string[] }
    const paths = (body.paths ?? []).map(item => String(item).trim()).filter(Boolean)

    if (paths.length === 0) {
      return NextResponse.json({ error: 'Keine Dateien angegeben.' }, { status: 400 })
    }

    const { error } = await supabaseAdmin.storage.from(PROPERTY_MEDIA_BUCKET).remove(paths)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
