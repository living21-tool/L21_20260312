export const PROPERTY_MEDIA_BUCKET = 'property-media'
export const PROPERTY_IMAGE_LIMIT = 10
export const PROPERTY_IMAGE_MAX_SIZE_BYTES = 8 * 1024 * 1024

export function isRemoteMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}
