import { Process } from '@/lib/types'
import { ProcessCard } from './ProcessCard'

interface ProcessListProps {
  processes: Process[]
}

export function ProcessList({ processes }: ProcessListProps) {
  if (processes.length === 0) {
    return (
      <div className="text-center py-12">
        <h3 className="text-xl font-serif font-bold text-text mb-2">No processes yet</h3>
        <p className="text-text-muted">Start your first SOP by creating a new process.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {processes.map((process) => (
        <ProcessCard key={process.id} process={process} />
      ))}
    </div>
  )
}
