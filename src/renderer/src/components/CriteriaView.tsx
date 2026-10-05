import { useMemo, useState, type ReactNode } from 'react'
import { rankByCriterion } from '../scoring'
import { useStore } from '../store'
import { criterionKey, useI18n } from '../i18n'
import { CRITERIA, EPISODE_AVG_CRITERION, type ComponentKey } from '../types'
import { Bar } from './ui'

export function CriteriaView({ onOpen }: { onOpen: (id: string) => void }): ReactNode {
  const { data } = useStore()
  const { t } = useI18n()
  const [key, setKey] = useState<ComponentKey>('characters')

  const options = useMemo(
    () => [...CRITERIA.map((c) => ({ key: c.key as ComponentKey, label: c.label, hue: c.hue })), EPISODE_AVG_CRITERION],
    []
  )

  const active = options.find((o) => o.key === key) ?? options[0]
  const ranking = useMemo(
    () => rankByCriterion(data.anime, key, data.settings.weights),
    [data.anime, data.settings.weights, key]
  )

  return (
    <>
      <div className="chips" style={{ marginBottom: 18 }}>
        {options.map((o) => (
          <button
            key={o.key}
            className={`chip${o.key === key ? ' active' : ''}`}
            onClick={() => setKey(o.key)}
          >
            {t(criterionKey(o.key))}
          </button>
        ))}
      </div>

      {data.anime.length === 0 ? (
        <div className="empty">
          <h3>{t('empty.criteria')}</h3>
          <p style={{ margin: 0 }}>{t('empty.criteriaBody')}</p>
        </div>
      ) : (
        <div className="table-wrap" style={{ padding: '8px 0' }}>
          <div
            className="hint"
            style={{ padding: '10px 16px 14px' }}
          >
              {t('criteria.rankingBy')}{' '}
              <strong style={{ color: `hsl(${active.hue} 65% 68%)` }}>
                {t(criterionKey(active.key))}
              </strong>{' '}
              {t('criteria.scoredHint')}
            </div>
          {ranking.map((row) => (
            <div
              key={row.anime.id}
              className="list-row"
              style={{ margin: '0 12px 8px', cursor: 'pointer' }}
              onClick={() => onOpen(row.anime.id)}
            >
              <div
                className="rank-cell"
                style={{
                  width: 34,
                  color: row.rank > 0 && row.rank <= 3 ? `hsl(${active.hue} 70% 62%)` : undefined
                }}
              >
                {row.rank > 0 ? `#${row.rank}` : '—'}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="t-title" style={{ fontSize: 13.5 }}>
                  {row.anime.title}
                </div>
                <div className="t-sub">
                  {row.anime.episodes.length} eps
                  {row.anime.year ? ` · ${row.anime.year}` : ''}
                </div>
              </div>
              <div style={{ width: '34%', minWidth: 120 }}>
                <Bar value={row.value} hue={active.hue} />
              </div>
              <div className="num" style={{ width: 46, textAlign: 'right' }}>
                {row.value === null ? '—' : row.value.toFixed(1)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
