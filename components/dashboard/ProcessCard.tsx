import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Process } from '@/lib/types'

interface ProcessCardProps {
  process: Process
}

export function ProcessCard({ process }: ProcessCardProps) {
  const phaseLabels: Record<number, string> = {
    0: 'Draft',
    1: 'Discovery',
    2: 'Steps',
    3: 'Roles',
    4: 'Tools',
    5: 'Decisions',
    6: 'Dependencies',
  }

  return (
    <Link href={`/process/${process.id}`}>
      <div className="bg-surface-2 border border-border rounded-lg p-6 hover:border-gold transition-colors cursor-pointer">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl font-serif font-bold text-text flex-1 line-clamp-2">
            {process.name || 'Untitled Process'}
          </h3>
          <Badge variant="gold">{phaseLabels[process.phase] || 'Phase ' + process.phase}</Badge>
        </div>

        {process.owner && <p className="text-sm text-text-muted mb-2">Owner: {process.owner}</p>}

        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-text-muted">Progress</span>
            <span className="text-xs font-bold text-gold">{process.completion}%</span>
          </div>
          <div className="w-full bg-surface-3 rounded-full h-2">
            <div
              className="bg-gold h-2 rounded-full transition-all"
              style={{ width: `${process.completion}%` }}
            />
          </div>
        </div>

        <p className="text-xs text-text-dim">
          Updated {new Date(process.updated_at).toLocaleDateString()}
        </p>
      </div>
    </Link>
  )
}
