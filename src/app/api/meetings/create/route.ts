import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createZoomMeeting } from '@/lib/zoom'
import { getProviderToken } from '@/lib/provider-tokens'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { topic, start_time, duration, provider } = await req.json()

  if (!topic || !start_time || !duration) {
    return NextResponse.json({ error: 'Missing required fields: topic, start_time, duration' }, { status: 400 })
  }

  try {
    if (provider === 'google_meet') {
      // Create Google Calendar event with Google Meet
      const googleToken = await getProviderToken(user.id, 'google')
      if (!googleToken) {
        return NextResponse.json({ error: 'Google account not connected. Sign in with Google or connect Google Calendar.' }, { status: 400 })
      }

      const endTime = new Date(new Date(start_time).getTime() + duration * 60000).toISOString()

      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${googleToken.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: topic,
          start: { dateTime: start_time, timeZone: 'America/Los_Angeles' },
          end: { dateTime: endTime, timeZone: 'America/Los_Angeles' },
          conferenceData: {
            createRequest: {
              requestId: `ctrl-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }),
      })
      const event = await res.json()

      if (!event.hangoutLink) {
        return NextResponse.json({ error: 'Failed to create Google Meet link', details: event }, { status: 500 })
      }

      return NextResponse.json({
        provider: 'google_meet',
        meeting_url: event.hangoutLink,
        event_id: event.id,
        event_link: event.htmlLink,
      })
    }

    // Default: Zoom
    const zoomToken = await getProviderToken(user.id, 'zoom')
    if (!zoomToken) {
      return NextResponse.json({ error: 'Zoom account not connected. Sign in with Zoom to create meetings.' }, { status: 400 })
    }

    const meeting = await createZoomMeeting(user.id, {
      topic,
      startTime: start_time,
      duration,
    })

    return NextResponse.json({
      provider: 'zoom',
      meeting_url: meeting.join_url,
      meeting_id: meeting.meeting_id,
      password: meeting.password,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
