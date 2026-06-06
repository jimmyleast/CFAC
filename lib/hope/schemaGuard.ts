import type { SOPData } from '@/lib/types'

type GuardResult = {
  data: SOPData | null
  coerced: boolean
  issues: string[]
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asString(item)).filter(Boolean)
}

export function coerceHopeSopData(input: unknown): GuardResult {
  if (!input || typeof input !== 'object') {
    return {
      data: null,
      coerced: false,
      issues: ['Payload was not an object'],
    }
  }

  const source = input as Record<string, unknown>
  const issues: string[] = []
  let coerced = false

  const steps = Array.isArray(source.steps)
    ? source.steps.map((rawStep, idx) => {
        if (!rawStep || typeof rawStep !== 'object') {
          coerced = true
          issues.push(`Step ${idx + 1} was not an object`) 
          return {
            id: idx + 1,
            name: `Step ${idx + 1}`,
            action: 'TBD action',
            owner: 'TBD owner',
            tool: 'manual/TBD',
            duration: 'TBD',
            isDecision: false,
          }
        }

        const step = rawStep as Record<string, unknown>
        return {
          id: typeof step.id === 'number' ? step.id : idx + 1,
          name: asString(step.name, `Step ${idx + 1}`),
          action: asString(step.action, 'TBD action'),
          owner: asString(step.owner, 'TBD owner'),
          tool: asString(step.tool, 'manual/TBD'),
          duration: asString(step.duration, 'TBD'),
          isDecision: Boolean(step.isDecision),
          handoffTo: asString(step.handoffTo),
          exceptionPath: asString(step.exceptionPath),
        }
      })
    : []

  if (!Array.isArray(source.steps)) {
    coerced = true
    issues.push('steps was not an array')
  }

  const architectureSource =
    source.architectureNotes && typeof source.architectureNotes === 'object'
      ? (source.architectureNotes as Record<string, unknown>)
      : null

  if (!architectureSource) {
    coerced = true
    issues.push('architectureNotes was missing or invalid')
  }

  const data: SOPData = {
    processName: asString(source.processName),
    owner: asString(source.owner, steps.length > 0 ? 'TBD owner' : ''),
    division: asString(source.division),
    category: asString(source.category),
    purpose: asString(source.purpose, steps.length > 0 ? 'TBD purpose' : ''),
    scope: asString(source.scope, steps.length > 0 ? 'TBD scope' : ''),
    steps,
    roles: Array.isArray(source.roles)
      ? source.roles
          .map((role) => {
            if (!role || typeof role !== 'object') return null
            const item = role as Record<string, unknown>
            return {
              name: asString(item.name),
              raci: ['R', 'A', 'C', 'I'].includes(asString(item.raci)) ? (asString(item.raci) as 'R' | 'A' | 'C' | 'I') : 'R',
              department: asString(item.department),
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [],
    decisions: Array.isArray(source.decisions)
      ? source.decisions
          .map((decision) => {
            if (!decision || typeof decision !== 'object') return null
            const item = decision as Record<string, unknown>
            return {
              question: asString(item.question),
              yes: asString(item.yes),
              no: asString(item.no),
              approvalRequired: Boolean(item.approvalRequired),
              bottleneck: Boolean(item.bottleneck),
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [],
    daciRoles: Array.isArray(source.daciRoles)
      ? source.daciRoles
          .map((daci) => {
            if (!daci || typeof daci !== 'object') return null
            const item = daci as Record<string, unknown>
            return {
              decision: asString(item.decision),
              driver: asString(item.driver),
              approver: asString(item.approver),
              contributors: asStringArray(item.contributors),
              informed: asStringArray(item.informed),
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [],
    systems: Array.isArray(source.systems)
      ? source.systems
          .map((system, idx) => {
            if (!system || typeof system !== 'object') return null
            const item = system as Record<string, unknown>
            const rawType = asString(item.type, 'other')
            const type = ['software', 'database', 'service', 'manual', 'other'].includes(rawType)
              ? (rawType as 'software' | 'database' | 'service' | 'manual' | 'other')
              : 'other'
            return {
              id: asString(item.id, `sys-${idx + 1}`),
              name: asString(item.name),
              type,
              owner: asString(item.owner),
              description: asString(item.description),
              usedInSteps: Array.isArray(item.usedInSteps)
                ? item.usedInSteps
                    .map((stepId) => (typeof stepId === 'number' ? stepId : Number(stepId)))
                    .filter((stepId) => Number.isFinite(stepId))
                : [],
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [],
    integrations: Array.isArray(source.integrations)
      ? source.integrations
          .map((integration) => {
            if (!integration || typeof integration !== 'object') return null
            const item = integration as Record<string, unknown>
            const rawType = asString(item.type, 'other')
            const type = ['api', 'manual', 'file', 'email', 'webhook', 'other'].includes(rawType)
              ? (rawType as 'api' | 'manual' | 'file' | 'email' | 'webhook' | 'other')
              : 'other'
            return {
              from: asString(item.from),
              to: asString(item.to),
              type,
              description: asString(item.description),
              isGap: Boolean(item.isGap),
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : [],
    architectureNotes: {
      summary: asString(architectureSource?.summary),
      gaps: asStringArray(architectureSource?.gaps),
      recommendations: asStringArray(architectureSource?.recommendations),
      automationOpportunities: asStringArray(architectureSource?.automationOpportunities),
    },
    dependencies: asStringArray(source.dependencies),
    followups: asStringArray(source.followups),
    kpis: asStringArray(source.kpis),
    phase: Math.max(1, Math.round(asNumber(source.phase, 1))),
    completion: Math.max(0, Math.min(100, Math.round(asNumber(source.completion, 0)))),
  }

  return { data, coerced, issues }
}
