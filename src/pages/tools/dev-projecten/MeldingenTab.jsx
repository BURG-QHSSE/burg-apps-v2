import { Fragment, useEffect, useState } from 'react'
import { fetchTroubleshootItems, updateTroubleshootStatus } from '../../../lib/troubleshootApi'
import { TOOLS } from '../../../lib/toolRegistry'

const STATUSSEN = ['nieuw', 'in_behandeling', 'afgehandeld']

const STATUS_LABELS = {
  nieuw: 'Nieuw',
  in_behandeling: 'In behandeling',
  afgehandeld: 'Afgehandeld',
}

export function toolNaamVoorPad(pad) {
  if (!pad || pad === '/') return 'Dashboard'
  return TOOLS.find((t) => t.path === pad)?.naam ?? pad
}

function fmtDatum(iso) {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function MeldingenTab() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [rowErrors, setRowErrors] = useState({})
  const [pendingIds, setPendingIds] = useState({})

  async function load() {
    try {
      const data = await fetchTroubleshootItems()
      setItems(data)
      setLoadError('')
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleStatusChange(id, status) {
    const previous = items.find((i) => i.id === id)?.status
    setItems((current) => current.map((i) => (i.id === id ? { ...i, status } : i)))
    setRowErrors((current) => ({ ...current, [id]: null }))
    setPendingIds((current) => ({ ...current, [id]: true }))

    try {
      await updateTroubleshootStatus(id, status)
    } catch (err) {
      setItems((current) => current.map((i) => (i.id === id ? { ...i, status: previous } : i)))
      setRowErrors((current) => ({ ...current, [id]: err.message }))
    } finally {
      setPendingIds((current) => ({ ...current, [id]: false }))
    }
  }

  return (
    <div>
      {loading && <p>Meldingen laden…</p>}

      {!loading && loadError && (
        <p className="form-error" role="alert">
          Kon meldingen niet laden: {loadError}
        </p>
      )}

      {!loading && !loadError && items.length === 0 && (
        <div className="idle-state">Nog geen meldingen binnengekomen.</div>
      )}

      {!loading && !loadError && items.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Van</th>
                <th>Datum</th>
                <th>Vanuit tool</th>
                <th>Omschrijving</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Fragment key={item.id}>
                  <tr>
                    <td data-label="Type">
                      <span className={item.type === 'probleem' ? 'badge badge-brand' : 'badge badge-blauwgrijs'}>
                        {item.type === 'probleem' ? 'Probleem' : 'Idee'}
                      </span>
                    </td>
                    <td data-label="Van">{item.ingediend_door?.naam || '—'}</td>
                    <td data-label="Datum">{fmtDatum(item.created_at)}</td>
                    <td data-label="Vanuit tool">{toolNaamVoorPad(item.vanuit_tool)}</td>
                    <td data-label="Omschrijving">{item.omschrijving}</td>
                    <td data-label="Status">
                      <select
                        value={item.status}
                        disabled={pendingIds[item.id]}
                        onChange={(e) => handleStatusChange(item.id, e.target.value)}
                      >
                        {STATUSSEN.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  {rowErrors[item.id] && (
                    <tr>
                      <td colSpan={6} style={{ paddingTop: 0 }}>
                        <p className="form-error form-error-inline" role="alert">
                          {rowErrors[item.id]}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
