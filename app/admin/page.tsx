import { redirect } from 'next/navigation'

export default function AdminIndexRedirect() {
  redirect('/admin/people')
}
