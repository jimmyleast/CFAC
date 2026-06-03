'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function HubRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/home') }, [router])
  return null
}
