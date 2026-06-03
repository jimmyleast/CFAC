import React from 'react'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'gold' | 'blue' | 'green' | 'red' | 'teal'
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  const variants = {
    default: 'pill',
    gold: 'pill pill--gold',
    blue: 'pill pill--teal',
    green: 'pill pill--success',
    red: 'pill pill--error',
    teal: 'pill pill--teal',
  }

  return <span className={variants[variant]}>{children}</span>
}
