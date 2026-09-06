import React from 'react'
import { LoaderCircle } from 'lucide-react'

export function Loading({ label }: { label: string }) {
  return <div className="loading"><LoaderCircle className="spin" /><span>{label}</span></div>
}
