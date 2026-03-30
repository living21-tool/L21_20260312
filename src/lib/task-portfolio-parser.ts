import type { Location, Property } from './types'

export type ParsedTaskPortfolioCommand = {
  cleanTitle: string
  propertyId?: string
  locationId?: string
  unitLabel?: string
  matchedProperty?: Property
  rawReference?: string
  ambiguousMatches?: Property[]
}

function toReferenceSegments(value: string) {
  return value
    .trim()
    .replace(/\//g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[./,_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

function normalizeSegment(value: string) {
  return normalize(value).replace(/\s+/g, '')
}

function formatReferenceSegment(segment: string) {
  const trimmed = segment.trim()
  if (!trimmed) {
    return ''
  }

  const compact = trimmed.replace(/\s+/g, '')

  const aufgMatch = compact.match(/^aufg\.?(\d+[a-z]?)$/i)
  if (aufgMatch) {
    return `Aufg.${aufgMatch[1].toUpperCase()}`
  }

  const roomMatch = compact.match(/^(zi|we)\.?(\d+[a-z]?)$/i)
  if (roomMatch) {
    return `${roomMatch[1].toUpperCase()}${roomMatch[2].toUpperCase()}`
  }

  if (/[0-9]/.test(compact)) {
    return compact.toUpperCase()
  }

  return compact.charAt(0).toUpperCase() + compact.slice(1).toLowerCase()
}

function formatTaskTitle(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => formatReferenceSegment(part))
    .join(' ')
}

function buildPropertyTerms(property: Property, location?: Location) {
  return [
    property.shortCode,
    property.name,
    ...(property.aliases ?? []),
    location?.name ?? '',
  ]
    .map(normalize)
    .filter(Boolean)
}

function getLeadingMatchRemainder(reference: string, term: string) {
  if (!reference.startsWith(term)) {
    return null
  }

  const remainder = reference.slice(term.length).trim()
  return remainder || null
}

function scorePropertyMatch(reference: string, property: Property, location?: Location) {
  const terms = buildPropertyTerms(property, location)
  let score = 0
  let extractedUnitLabel: string | undefined

  for (const term of terms) {
    if (reference === term) {
      return {
        score: 1000,
        extractedUnitLabel: undefined,
      }
    }

    const remainder = getLeadingMatchRemainder(reference, term)
    if (remainder) {
      const remainderScore = 820 - remainder.length
      if (remainderScore > score) {
        score = remainderScore
        extractedUnitLabel = remainder.toUpperCase()
      }
    }

    if (term.startsWith(reference)) {
      score = Math.max(score, 520 - (term.length - reference.length))
    }

    if (term.includes(reference)) {
      score = Math.max(score, 300 - (term.length - reference.length))
    }

    const referenceTokens = reference.split(' ').filter(Boolean)
    const termTokens = term.split(' ').filter(Boolean)
    const allReferenceTokensMatch = referenceTokens.length > 0 && referenceTokens.every(token =>
      termTokens.some(termToken => termToken === token || termToken.startsWith(token) || token.startsWith(termToken)),
    )

    if (allReferenceTokensMatch) {
      score = Math.max(score, 420 + referenceTokens.length * 20)
    }
  }

  return {
    score,
    extractedUnitLabel,
  }
}

function buildStandardizedTitle(
  matchedProperty: Property,
  reference: string,
  explicitTitlePart: string,
) {
  const referenceSegments = toReferenceSegments(reference)
  const propertySegments = toReferenceSegments(matchedProperty.shortCode)
  const normalizedPropertySegments = propertySegments.map(normalizeSegment)

  const matchedIndexes = referenceSegments.reduce<number[]>((indexes, segment, index) => {
    if (normalizedPropertySegments.includes(normalizeSegment(segment))) {
      indexes.push(index)
    }
    return indexes
  }, [])

  const lastReferenceIndex = matchedIndexes.length > 0 ? Math.max(...matchedIndexes) : propertySegments.length - 1
  const prefixSegments = referenceSegments.slice(0, Math.max(lastReferenceIndex + 1, propertySegments.length))
  const titleSegments = explicitTitlePart
    ? [explicitTitlePart]
    : referenceSegments.slice(lastReferenceIndex + 1)

  const formattedPrefix = prefixSegments.map(formatReferenceSegment).join(' / ')
  const formattedTitle = explicitTitlePart
    ? explicitTitlePart.trim()
    : formatTaskTitle(titleSegments.join(' '))

  return formattedTitle ? `${formattedPrefix} // ${formattedTitle}` : formattedPrefix
}

export function parseTaskPortfolioCommand(
  input: string,
  properties: Property[],
  locations: Location[],
): ParsedTaskPortfolioCommand {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) {
    return { cleanTitle: input.trim() }
  }

  const withoutSlash = trimmed.slice(1).trim()
  const dashIndex = withoutSlash.indexOf(' - ')
  const reference = (dashIndex >= 0 ? withoutSlash.slice(0, dashIndex) : withoutSlash).trim()
  const titlePart = (dashIndex >= 0 ? withoutSlash.slice(dashIndex + 3) : '').trim()

  if (!reference) {
    return { cleanTitle: titlePart || input.trim() }
  }

  const referenceParts = reference.split(/\s+/).filter(Boolean)
  const normalizedReference = normalize(reference)
  const fallbackUnitLabel = referenceParts.slice(1).join(' ').trim() || undefined

  const rankedMatches = properties
    .map(property => {
      const location = locations.find(item => item.id === property.locationId)
      const match = scorePropertyMatch(normalizedReference, property, location)
      return {
        property,
        score: match.score,
        extractedUnitLabel: match.extractedUnitLabel,
      }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  const bestMatch = rankedMatches[0]
  const secondMatch = rankedMatches[1]
  const isAmbiguous =
    !bestMatch
      ? false
      : bestMatch.score < 700 && rankedMatches.length > 1
        ? bestMatch.score - (secondMatch?.score ?? 0) < 80
        : bestMatch.score < 1000 && rankedMatches.length > 1 && bestMatch.score === (secondMatch?.score ?? -1)

  const matchedProperty = !isAmbiguous ? bestMatch?.property : undefined

  if (!matchedProperty) {
    return {
      cleanTitle: titlePart || input.trim(),
      unitLabel: fallbackUnitLabel,
      rawReference: reference,
      ambiguousMatches: isAmbiguous ? rankedMatches.slice(0, 4).map(entry => entry.property) : undefined,
    }
  }

  return {
    cleanTitle: buildStandardizedTitle(matchedProperty, reference, titlePart) || input.trim(),
    propertyId: matchedProperty.id,
    locationId: matchedProperty.locationId,
    unitLabel: bestMatch?.extractedUnitLabel ?? fallbackUnitLabel,
    matchedProperty,
    rawReference: reference,
  }
}
