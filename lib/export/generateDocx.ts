import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
} from 'docx'
import { SOPData } from '@/lib/types'

export async function generateDocx(sopData: SOPData): Promise<Buffer> {
  const actionPlan: Array<{ title: string; owner: string; horizon: string }> = []
  if (!sopData.owner?.trim()) {
    actionPlan.push({
      title: 'Assign a single accountable process owner (use TBD owner if undecided).',
      owner: 'TBD owner',
      horizon: '7 days',
    })
  }
  if (!sopData.scope?.trim()) {
    actionPlan.push({
      title: 'Define in-scope and out-of-scope boundaries for this process.',
      owner: sopData.owner?.trim() || 'TBD owner',
      horizon: '7 days',
    })
  }
  if ((sopData.steps || []).length < 5) {
    actionPlan.push({
      title: 'Expand process map to at least 5 explicit steps with owner + system per step.',
      owner: sopData.owner?.trim() || 'TBD owner',
      horizon: '14 days',
    })
  }
  if ((sopData.roles || []).length < 3) {
    actionPlan.push({
      title: 'Complete RACI roles for key steps and remove ownership ambiguity.',
      owner: sopData.owner?.trim() || 'TBD owner',
      horizon: '14 days',
    })
  }
  if ((sopData.kpis || []).length < 2) {
    actionPlan.push({
      title: 'Define 2+ KPIs with target ranges (TBD targets allowed initially).',
      owner: sopData.owner?.trim() || 'TBD owner',
      horizon: '30 days',
    })
  }
  if (actionPlan.length === 0) {
    actionPlan.push({
      title: 'Run a weekly governance review and validate KPI trend vs target.',
      owner: sopData.owner?.trim() || 'Process Owner',
      horizon: '30 days',
    })
  }

  const children = [
    // Title
    new Paragraph({
      children: [
        new TextRun({
          text: sopData.processName || 'Untitled Process',
          bold: true,
          size: 56,
        }),
      ],
      spacing: { after: 200 },
    }),

    // Meta information
    ...([
      `Owner: ${sopData.owner || 'N/A'}`,
      `Division: ${sopData.division || 'N/A'}`,
      `Category: ${sopData.category || 'N/A'}`,
      `Version: 1.0 Draft`,
      `Date: ${new Date().toLocaleDateString()}`,
    ].map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
          spacing: { after: 100 },
        })
    )),

    new Paragraph({ text: '' }),

    // Purpose & Scope
    new Paragraph({
      children: [new TextRun({ text: '1. Purpose & Scope', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),
    new Paragraph({
      text: sopData.purpose || 'Not specified',
      spacing: { after: 200 },
    }),

    // Process Steps
    new Paragraph({
      children: [new TextRun({ text: '2. Process Steps', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...sopData.steps.map(
      (step) =>
        new Paragraph({
          children: [
            new TextRun({
              text: `Step ${step.id}: ${step.name}`,
              bold: true,
              size: 24,
            }),
            new TextRun({
              text: `\nAction: ${step.action}\nOwner: ${step.owner}\nTool: ${step.tool}\nDuration: ${step.duration}`,
              size: 22,
            }),
          ],
          spacing: { after: 100 },
        })
    ),

    new Paragraph({ text: '' }),

    // RACI Chart
    new Paragraph({
      children: [new TextRun({ text: '3. RACI Chart', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: 'Step', bold: true })] })],
              shading: { fill: 'C9A84C' },
            }),
            ...sopData.roles.map(
              (role) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: role.name, bold: true })] })],
                  shading: { fill: 'C9A84C' },
                })
            ),
          ],
        }),
        ...sopData.steps.map(
          (step) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ text: step.name })],
                }),
                ...sopData.roles.map((role) => {
                  const isOwner = role.name === step.owner
                  const raciValue = isOwner ? 'R' : ''
                  return new TableCell({
                    children: [new Paragraph({ text: raciValue })],
                  })
                }),
              ],
            })
        ),
      ],
    }),

    new Paragraph({ text: '' }),

    // Decision Logic
    new Paragraph({
      children: [new TextRun({ text: '4. Decision Logic', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...sopData.decisions.flatMap((decision) => [
      new Paragraph({
        children: [new TextRun({ text: decision.question, bold: true })],
        spacing: { after: 50 },
      }),
      new Paragraph({
        text: `  ✓ YES → ${decision.yes}`,
        spacing: { after: 50 },
      }),
      new Paragraph({
        text: `  ✗ NO  → ${decision.no}`,
        spacing: { after: 100 },
      }),
    ]),

    // Dependencies
    new Paragraph({
      children: [new TextRun({ text: '5. Dependencies', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...(sopData.dependencies.length > 0
      ? sopData.dependencies.map(
          (dep) =>
            new Paragraph({
              text: `• ${dep}`,
              spacing: { after: 50 },
            })
        )
      : [new Paragraph({ text: 'None specified' })]),

    new Paragraph({ text: '' }),

    // KPIs
    new Paragraph({
      children: [new TextRun({ text: '6. KPIs & Success Metrics', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...(sopData.kpis.length > 0
      ? sopData.kpis.map(
          (kpi) =>
            new Paragraph({
              text: `• ${kpi}`,
              spacing: { after: 50 },
            })
        )
      : [new Paragraph({ text: 'None specified' })]),

    new Paragraph({ text: '' }),

    // Systems Inventory
    new Paragraph({
      children: [new TextRun({ text: '7. Systems Inventory', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...(sopData.systems.length > 0
      ? sopData.systems.flatMap((sys) => [
          new Paragraph({
            children: [new TextRun({ text: `${sys.name} (${sys.type})`, bold: true, size: 24 })],
            spacing: { after: 50 },
          }),
          new Paragraph({
            text: `Owner: ${sys.owner || 'N/A'} | Description: ${sys.description || 'N/A'}`,
            spacing: { after: 100 },
          }),
        ])
      : [new Paragraph({ text: 'No systems captured.' })]),

    new Paragraph({ text: '' }),

    // Integration Map
    new Paragraph({
      children: [new TextRun({ text: '8. Integration Map', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...(sopData.integrations.length > 0
      ? sopData.integrations.map(
          (intg) =>
            new Paragraph({
              text: `${intg.from} → [${intg.type}] → ${intg.to}${intg.isGap ? ' ⚠ GAP' : ''}${intg.description ? ` — ${intg.description}` : ''}`,
              spacing: { after: 80 },
            })
        )
      : [new Paragraph({ text: 'No integrations captured.' })]),

    new Paragraph({ text: '' }),

    // Gap Analysis
    new Paragraph({
      children: [new TextRun({ text: '9. Gap Analysis & Recommendations', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...(sopData.architectureNotes.summary
      ? [new Paragraph({ text: sopData.architectureNotes.summary, spacing: { after: 100 } })]
      : []),

    ...(sopData.architectureNotes.gaps.length > 0
      ? [
          new Paragraph({ children: [new TextRun({ text: 'Gaps:', bold: true })], spacing: { after: 50 } }),
          ...sopData.architectureNotes.gaps.map((g) => new Paragraph({ text: `• ${g}`, spacing: { after: 50 } })),
        ]
      : []),

    ...(sopData.architectureNotes.automationOpportunities.length > 0
      ? [
          new Paragraph({ children: [new TextRun({ text: 'Automation Opportunities:', bold: true })], spacing: { before: 100, after: 50 } }),
          ...sopData.architectureNotes.automationOpportunities.map((a) => new Paragraph({ text: `• ${a}`, spacing: { after: 50 } })),
        ]
      : []),

    ...(sopData.architectureNotes.recommendations.length > 0
      ? [
          new Paragraph({ children: [new TextRun({ text: 'Recommendations:', bold: true })], spacing: { before: 100, after: 50 } }),
          ...sopData.architectureNotes.recommendations.map((r) => new Paragraph({ text: `• ${r}`, spacing: { after: 50 } })),
        ]
      : []),

    new Paragraph({ text: '' }),

    // 30-Day Action Plan
    new Paragraph({
      children: [new TextRun({ text: '10. 30-Day Action Plan', bold: true, size: 32 })],
      spacing: { before: 200, after: 100 },
    }),

    ...actionPlan.map((item) =>
      new Paragraph({
        children: [
          new TextRun({ text: `• ${item.title}`, bold: true }),
          new TextRun({ text: `\n  Owner: ${item.owner} | Horizon: ${item.horizon}` }),
        ],
        spacing: { after: 100 },
      })
    ),
  ]

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })

  return await Packer.toBuffer(doc)
}
