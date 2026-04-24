import { redirect } from 'next/navigation'

export default function SchedulesRedirect() {
  redirect('/dispatch?tab=schedules')
}
