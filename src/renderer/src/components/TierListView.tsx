/**
 * The TierList tab.
 *
 * Two screens in one: a grid of the lists (A1), and the board itself once one is
 * open. The grid shows a miniature of the board rather than a line of text,
 * because a tier list is a visual object and five bands of colour say what it is
 * faster than any wording.
 *
 * Creating is deliberately frictionless: the button opens the board straight away
 * with a default name, and the kind is chosen in a dialog because it decides what
 * the picker offers. It cannot be changed afterwards, which the dialog says.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { useStore } from '../store'
import { addItems, boardView, createTierList, renameList, rowGradient, statsOf } from '../tierlist'
import { TIER_LIST_KINDS, type TierItem, type TierList, type TierListKind } from '../types'
import { TierListBoard } from './TierListBoard'
import { TierItemPicker } from './TierItemPicker'
import { Modal } from './ui'
import { IconPlus, IconTrash } from './Icons'

export function TierListView(): ReactNode {
  const { t } = useI18n()
  const { data, addTierList, updateTierList, removeTierList } = useStore()

  const [openId, setOpenId] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const lists = data.tierLists
  const open = useMemo(() => lists.find((list) => list.id === openId) ?? null, [lists, openId])

  const onCreate = (kind: TierListKind): void => {
    const list = createTierList(t('tierlist.new'), kind)
    addTierList(list)
    setCreating(false)
    setOpenId(list.id)
  }

  if (open) {
    return (
      <div className="tl-split">
        <div className="tl-main">
          <TierListBoard
            list={open}
            onClose={() => {
              setOpenId(null)
              setPicking(false)
            }}
            onAddItems={() => setPicking(true)}
            onChange={(next) => updateTierList(open.id, next)}
          />
        </div>
        {picking && (
          <TierItemPicker
            list={open}
            onAdd={(items: TierItem[]) => updateTierList(open.id, (current) => addItems(current, items))}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <span className="hint">{t('tierlist.count', { count: lists.length })}</span>
        <span className="grow" />
        <button className="btn primary" onClick={() => setCreating(true)}>
          <IconPlus size={15} /> {t('tierlist.new')}
        </button>
      </div>

      {lists.length === 0 ? (
        <div className="empty">
          <div className="big">ティア</div>
          <h3>{t('empty.tierlist.title')}</h3>
          <p style={{ maxWidth: 460, margin: 0 }}>{t('empty.tierlist.body')}</p>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <IconPlus size={16} /> {t('empty.tierlist.cta')}
          </button>
        </div>
      ) : (
        <div className="tl-grid">
          {lists.map((list) => (
            <TierListCard
              key={list.id}
              list={list}
              onOpen={() => setOpenId(list.id)}
              onRename={() => setRenaming(list.id)}
              onDelete={() => {
                removeTierList(list.id)
                if (openId === list.id) setOpenId(null)
              }}
            />
          ))}
          <button className="tl-card new" onClick={() => setCreating(true)}>
            <span>
              <span className="big">
                <IconPlus size={22} />
              </span>
              {t('tierlist.new')}
            </span>
          </button>
        </div>
      )}

      {creating && <KindDialog onPick={onCreate} onClose={() => setCreating(false)} />}

      {renaming !== null && (
        <RenameDialog
          initial={lists.find((list) => list.id === renaming)?.name ?? ''}
          onSave={(name) => {
            updateTierList(renaming, (current) => renameList(current, name))
            setRenaming(null)
          }}
          onClose={() => setRenaming(null)}
        />
      )}
    </>
  )
}

/** One card: a miniature of the board, then the name and the count. */
function TierListCard({
  list,
  onOpen,
  onRename,
  onDelete
}: {
  list: TierList
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}): ReactNode {
  const { t } = useI18n()
  const view = useMemo(() => boardView(list), [list])
  const stats = useMemo(() => statsOf(list), [list])
  // Five bands is enough to read the shape; more would be unreadable at this size.
  const preview = view.rows.slice(0, 5)

  return (
    <div className="tl-card">
      <button className="preview" onClick={onOpen} title={list.name}>
        {preview.map(({ row, items }) => (
          <span className="prow" key={row.id}>
            <span className="plabel" style={{ background: rowGradient(row) }}>
              {row.label.slice(0, 2)}
            </span>
            <span className="parea">
              {items.slice(0, 6).map((item) => (
                <span key={item.id} className="ptile">
                  {item.image ? <img src={item.image} alt="" loading="lazy" draggable={false} /> : null}
                </span>
              ))}
            </span>
          </span>
        ))}
      </button>

      <div className="info">
        <div className="row1">
          <button className="name" onClick={onRename} title={t('tierlist.rename')}>
            {list.name}
          </button>
          <button className="icon-btn" onClick={onDelete} title={t('tierlist.delete')}>
            <IconTrash size={13} />
          </button>
        </div>
        <div className="meta">
          <span className="kind">{t(`tierlist.kind.${list.kind}`)}</span>
          <span>{t('tierlist.items', { count: stats.items })}</span>
        </div>
      </div>
    </div>
  )
}

/** The kind has to be asked, because the picker cannot guess it. */
function KindDialog({
  onPick,
  onClose
}: {
  onPick: (kind: TierListKind) => void
  onClose: () => void
}): ReactNode {
  const { t } = useI18n()
  return (
    <Modal title={t('tierlist.kindQuestion')} subtitle={t('tierlist.kindHint')} onClose={onClose}>
      <div className="tl-kinds">
        {TIER_LIST_KINDS.map((kind) => (
          <button key={kind} className="btn" onClick={() => onPick(kind)}>
            {t(`tierlist.kind.${kind}`)}
          </button>
        ))}
      </div>
    </Modal>
  )
}

function RenameDialog({
  initial,
  onSave,
  onClose
}: {
  initial: string
  onSave: (name: string) => void
  onClose: () => void
}): ReactNode {
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  return (
    <Modal title={t('tierlist.rename')} onClose={onClose}>
      <div className="field">
        <input
          className="input"
          autoFocus
          value={value}
          placeholder={t('tierlist.namePlaceholder')}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSave(value)
          }}
        />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button className="btn primary" onClick={() => onSave(value)} disabled={value.trim() === ''}>
          {t('action.save')}
        </button>
      </div>
    </Modal>
  )
}
