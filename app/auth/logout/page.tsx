'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LogoutPage() {
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.signOut().finally(() => {
      window.location.replace('/auth/login')
    })
  }, [])

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0D0D0F',
      color: '#8A8680',
      fontFamily: 'DM Sans, sans-serif',
    }}>
      Signing out...
    </main>
  )
}
