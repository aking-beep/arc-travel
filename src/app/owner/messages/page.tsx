import { Mail } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getTranslator } from '@/lib/i18n/server'
import { EmailStatus } from '@/lib/prisma-types'
import { requireActor } from '@/modules/auth/service'
import { resolveOperatingProperty } from '@/modules/hotels/service'
import {
  canSendEmail,
  describeKind,
  listOrganizationEmails,
} from '@/modules/notifications/service'

export const metadata = { title: 'Messages' }

/**
 * Every message ARC sent on this hotel's behalf, and every one it would have.
 *
 * This page is the reason `MAIL_PROVIDER=log` is a real mode rather than a
 * stub. A hotel deciding whether to let ARC write to its guests and its
 * partners needs to read the actual words first, including the link, and a
 * product that sends nothing and shows nothing cannot be evaluated at all.
 *
 * Password resets are absent by design: they carry no `organizationId`, so the
 * query cannot reach them. An owner has no business reading the reset of
 * somebody who happens to be their guest.
 */
export default async function MessagesPage() {
  const actor = await requireActor()
  const { organizationId } = await resolveOperatingProperty(actor)
  const { locale, t } = await getTranslator()

  const messages = await listOrganizationEmails(organizationId)
  const delivering = canSendEmail()

  const statusLabel = (status: EmailStatus): string => {
    switch (status) {
      case EmailStatus.QUEUED:
        return t('email.status.queued')
      case EmailStatus.SENT:
        return t('email.status.sent')
      case EmailStatus.LOGGED:
        return t('email.status.logged')
      case EmailStatus.FAILED:
        return t('email.status.failed')
    }
  }

  const statusTone = (status: EmailStatus): 'success' | 'neutral' | 'danger' => {
    if (status === EmailStatus.SENT) return 'success'
    if (status === EmailStatus.FAILED) return 'danger'
    return 'neutral'
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <div className="flex items-center gap-2">
          <Mail className="text-jade-700 size-5" aria-hidden />
          <h1 className="font-display text-2xl font-semibold">{t('email.log.title')}</h1>
        </div>
        <p className="text-sand-600 mt-1 max-w-prose text-sm leading-relaxed">
          {t('email.log.lede')}
        </p>
        {!delivering ? (
          <p className="border-sand-200 bg-sand-50 text-sand-700 mt-4 max-w-prose rounded-lg border px-4 py-3 text-sm leading-relaxed">
            {t('email.log.notConfigured')}
          </p>
        ) : null}
      </div>

      {messages.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="font-medium">{t('email.log.empty')}</p>
            <p className="text-sand-600 mt-1 text-sm">{t('email.log.emptyHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-4">
          {messages.map((message) => (
            <li key={message.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{message.subject}</CardTitle>
                      <p className="text-sand-600 mt-1 text-sm">
                        {describeKind(message.kind, locale)} · {t('email.log.toLabel')}{' '}
                        {message.toName ? `${message.toName} · ` : ''}
                        {message.toAddress}
                      </p>
                    </div>
                    <Badge tone={statusTone(message.status)}>
                      {statusLabel(message.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sand-500 text-xs">
                    <time dateTime={message.queuedAt.toISOString()}>
                      {message.queuedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
                    </time>
                    {message.attempts > 0
                      ? ` · ${t('email.log.attempts', { count: message.attempts })}`
                      : ''}
                    {message.provider ? ` · ${message.provider}` : ''}
                  </p>

                  {message.lastError ? (
                    <p className="border-red-200 bg-red-50 text-red-800 rounded border px-3 py-2 text-xs">
                      {t('email.log.error')}: {message.lastError}
                    </p>
                  ) : null}

                  {/*
                   * The whole body, in a details element.
                   *
                   * Collapsed rather than truncated: the thing an owner needs
                   * from this page is the exact text, link included, and a
                   * clipped preview would cut off precisely the link. Native
                   * details so it works without JavaScript and reads correctly
                   * to a screen reader.
                   */}
                  <details className="group">
                    <summary className="text-jade-800 cursor-pointer text-sm underline underline-offset-4">
                      <span className="group-open:hidden">{t('email.log.show')}</span>
                      <span className="hidden group-open:inline">{t('email.log.hide')}</span>
                    </summary>
                    <pre className="border-sand-200 bg-sand-50 mt-3 overflow-x-auto rounded border p-3 text-xs leading-relaxed whitespace-pre-wrap">
                      {message.body}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
