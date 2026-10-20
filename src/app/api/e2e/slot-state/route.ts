import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { sweepExpiredHolds } from '@/modules/inventory/service'

/**
 * Inventory inspection for the acceptance suite.
 *
 * Exists so an E2E test can assert on the counters rather than on rendered
 * text, which is the difference between proving "inventory decreased" and
 * proving "a number on a page changed".
 *
 * Only available while ARC_DATA_MODE=demo. In any other mode it 404s, so it
 * cannot become an information leak in a pilot or live deployment. It exposes
 * no guest data — capacity integers and an invariant check, nothing else.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (getEnv().ARC_DATA_MODE !== 'demo') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const slug = url.searchParams.get('experienceSlug')
  if (!slug) {
    return NextResponse.json({ error: 'experienceSlug is required' }, { status: 400 })
  }

  const experience = await prisma.experience.findFirst({
    where: { slug },
    select: { id: true, slug: true, titleEn: true },
  })
  if (!experience) {
    return NextResponse.json({ error: 'Experience not found' }, { status: 404 })
  }

  const slotIds = (
    await prisma.availabilitySlot.findMany({
      where: { experienceId: experience.id, startsAt: { gte: new Date() } },
      select: { id: true },
    })
  ).map((s) => s.id)
  await sweepExpiredHolds({ slotIds })

  const slots = await prisma.availabilitySlot.findMany({
    where: { experienceId: experience.id, startsAt: { gte: new Date() } },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      capacity: true,
      booked: true,
      held: true,
      status: true,
    },
  })

  return NextResponse.json({
    experience: { id: experience.id, slug: experience.slug, title: experience.titleEn },
    slots,
    // The one thing that must never be false.
    invariantHolds: slots.every((s) => s.booked + s.held <= s.capacity),
  })
}
