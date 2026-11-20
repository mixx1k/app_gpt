import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Banknote,
  Check,
  Coffee,
  CreditCard,
  Croissant,
  CupSoda,
  Minus,
  Plus,
  Printer,
  Sandwich,
  X,
} from 'lucide-react';
import { api, dateTime, errorMessage, money, parseMoney } from './api';
import type { Category, Checkout, Movement, Product, Sale } from './types';

export const categories: Category[] = ['Kawa', 'Wypieki', 'Napoje', 'Jedzenie'];
export const categoryIcons = {
  Kawa: Coffee,
  Wypieki: Croissant,
  Napoje: CupSoda,
  Jedzenie: Sandwich,
};

export function ProductArt({ product, small = false }: { product: Product; small?: boolean }) {
  const Icon = categoryIcons[product.category];
  return (
    <span
      aria-hidden="true"
      className={`product-art art-${categories.indexOf(product.category)} ${small ? 'small' : ''}`}
    >
      <span className="art-circle" />
      <Icon strokeWidth={1.3} />
      <span className="art-spark spark-one" />
      <span className="art-spark spark-two" />
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  locked = false,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  locked?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Zamknij okno"
          disabled={locked}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Payment({
  draft,
  pending,
  busy,
  error,
  onPay,
  onClose,
}: {
  draft: Omit<Checkout, 'requestId' | 'paymentMethod' | 'cashReceivedCents'>;
  pending: Checkout | null;
  busy: boolean;
  error: string;
  onPay: (method: 'cash' | 'card', cash: number | null) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<'cash' | 'card'>(pending?.paymentMethod ?? 'cash');
  const order = pending || draft;
  const subtotal = order.items.reduce(
    (sum, item) => sum + item.expectedPriceCents * item.quantity,
    0,
  );
  const total = subtotal - Math.round((subtotal * order.discountPercent) / 100);
  const [cash, setCash] = useState(
    String((pending?.cashReceivedCents ?? total) / 100).replace('.', ','),
  );
  const tendered = parseMoney(cash);
  const locked = busy || Boolean(pending);
  return (
    <Modal title="Rozlicz zamówienie" onClose={onClose} locked={locked}>
      <div className="payment-total">
        <span>Do zapłaty</span>
        <strong>{money(total)}</strong>
        <span>
          {order.orderType === 'takeaway'
            ? 'Na wynos'
            : order.tableNumber
              ? `Na miejscu · stolik ${order.tableNumber}`
              : 'Na miejscu'}
        </span>
      </div>
      <div className="payment-options">
        <button
          className={method === 'cash' ? 'selected' : ''}
          disabled={locked}
          onClick={() => setMethod('cash')}
        >
          <Banknote />
          Gotówka
        </button>
        <button
          className={method === 'card' ? 'selected' : ''}
          disabled={locked}
          onClick={() => setMethod('card')}
        >
          <CreditCard />
          Karta
        </button>
      </div>
      {method === 'cash' ? (
        <>
          <label>
            Przyjęta gotówka (zł)
            <input
              autoFocus
              inputMode="decimal"
              value={cash}
              disabled={locked}
              onChange={(event) => setCash(event.target.value)}
            />
          </label>
          <div className="change-line">
            <span>Reszta</span>
            <strong>
              {tendered !== null && tendered >= total ? money(tendered - total) : '—'}
            </strong>
          </div>
        </>
      ) : (
        <p className="info-box">
          Potwierdź zapis dopiero po zaakceptowaniu płatności na terminalu. Ta aplikacja nie pobiera
          pieniędzy z karty.
        </p>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {pending && !busy && (
        <p className="info-box">
          Oczekuje potwierdzenie zapisu. Ponowienie użyje tego samego identyfikatora, aby uniknąć
          podwójnej sprzedaży.
        </p>
      )}
      <button
        className="primary full"
        disabled={
          busy || (!pending && method === 'cash' && (tendered === null || tendered < total))
        }
        onClick={() => onPay(method, method === 'cash' ? tendered : null)}
      >
        <Check size={18} />
        {busy ? 'Zapisywanie…' : pending ? 'Ponów potwierdzenie' : 'Potwierdź otrzymanie płatności'}
      </button>
      <p className="fine-print">Zapis sprzedaży nie zastępuje paragonu fiskalnego.</p>
    </Modal>
  );
}

export function Receipt({
  sale,
  onClose,
  onVoid,
}: {
  sale: Sale;
  onClose: () => void;
  onVoid?: () => void;
}) {
  return (
    <Modal
      title={sale.status === 'voided' ? 'Anulowane zamówienie' : 'Podsumowanie zamówienia'}
      onClose={onClose}
    >
      <div className="receipt">
        <div className="receipt-brand">
          <Coffee size={31} />
          <h3>Młynek</h3>
          <span>KAWIARNIA · POTWIERDZENIE SPRZEDAŻY</span>
        </div>
        <div className="receipt-meta">
          <strong>{sale.number}</strong>
          <span>{dateTime(sale.createdAt)}</span>
          <span>
            {sale.orderType === 'takeaway'
              ? 'Na wynos'
              : sale.tableNumber
                ? `Na miejscu · stolik ${sale.tableNumber}`
                : 'Na miejscu'}
          </span>
        </div>
        {sale.status === 'voided' && (
          <p className="error-box">ANULOWANO · {sale.voidedAt && dateTime(sale.voidedAt)}</p>
        )}
        <div className="receipt-items">
          {sale.items.map((item) => (
            <div key={item.productId}>
              <span>
                {item.quantity} × {item.name}
                <small>
                  {money(item.unitPriceCents)} / szt. · VAT {item.vatRate}%
                </small>
              </span>
              <strong>{money(item.totalCents)}</strong>
            </div>
          ))}
        </div>
        {sale.discountCents > 0 && (
          <div className="receipt-row">
            <span>Rabat ({sale.discountPercent}%)</span>
            <span>−{money(sale.discountCents)}</span>
          </div>
        )}
        <div className="receipt-row total">
          <strong>Razem</strong>
          <strong>{money(sale.totalCents)}</strong>
        </div>
        <div className="receipt-row">
          <span>W tym VAT</span>
          <span>{money(sale.vatCents)}</span>
        </div>
        <div className="receipt-row">
          <span>Płatność</span>
          <span>{sale.paymentMethod === 'cash' ? 'Gotówka' : 'Karta — terminal zewnętrzny'}</span>
        </div>
        {sale.paymentMethod === 'cash' && (
          <>
            <div className="receipt-row">
              <span>Przyjęto</span>
              <span>{money(sale.cashReceivedCents ?? 0)}</span>
            </div>
            <div className="receipt-row">
              <span>Reszta</span>
              <span>{money(sale.changeCents)}</span>
            </div>
          </>
        )}
        {sale.note && <p className="receipt-note">Uwagi: {sale.note}</p>}
        <p className="fine-print">DOKUMENT NIEFISKALNY</p>
      </div>
      <div className="modal-actions">
        <button className="secondary" onClick={() => window.print()}>
          <Printer size={17} />
          Drukuj
        </button>
        <button className="primary" onClick={onClose}>
          Gotowe
          <Check size={17} />
        </button>
      </div>
      {onVoid && sale.status === 'completed' && (
        <button className="text-button danger full" onClick={onVoid}>
          Anuluj sprzedaż i przywróć stan
        </button>
      )}
    </Modal>
  );
}

export function ProductEditor({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState<Category>(product?.category ?? 'Kawa');
  const [price, setPrice] = useState(
    product ? String(product.priceCents / 100).replace('.', ',') : '',
  );
  const [vat, setVat] = useState(product?.vatRate ?? 23);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const priceCents = parseMoney(price);
    if (!priceCents || priceCents > 1000000) {
      setError('Wpisz cenę od 0,01 do 10 000,00 zł.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/products${product ? `/${product.id}` : ''}`, {
        method: product ? 'PUT' : 'POST',
        body: JSON.stringify({ name, category, priceCents, vatRate: vat }),
      });
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={product ? 'Edytuj produkt' : 'Dodaj produkt do menu'}
      onClose={onClose}
      locked={busy}
    >
      <form onSubmit={submit}>
        <label>
          Nazwa produktu
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Kategoria
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Cena brutto (zł)
            <input
              required
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <label>
            Stawka VAT
            <select value={vat} onChange={(event) => setVat(Number(event.target.value))}>
              {[0, 5, 8, 23].map((rate) => (
                <option value={rate} key={rate}>
                  {rate}%
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="fine-print">
          Dobierz VAT do produktu i sposobu sprzedaży. Przykładowe menu zawiera stawki
          demonstracyjne.
        </p>
        {!product && (
          <p className="info-box">
            Nowy produkt ma stan 0. Po zapisaniu dodaj dostawę w magazynie.
          </p>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? 'Zapisywanie…' : 'Zapisz produkt'}
        </button>
      </form>
    </Modal>
  );
}

export function StockEditor({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState('10');
  const [reason, setReason] = useState('Dostawa');
  const [direction, setDirection] = useState(1);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<Movement[]>(`/products/${product.id}/movements`)
      .then((data) => {
        if (active) setMovements(data);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [product.id]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/products/${product.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Number(quantity) * direction, reason }),
      });
      onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Zmień stan magazynowy" onClose={onClose} locked={busy}>
      <div className="stock-product">
        <ProductArt product={product} small />
        <div>
          <strong>{product.name}</strong>
          <span>Aktualny stan: {product.stock} szt.</span>
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="segmented">
          <button
            type="button"
            className={direction === 1 ? 'active' : ''}
            onClick={() => setDirection(1)}
          >
            <Plus size={16} />
            Przyjęcie
          </button>
          <button
            type="button"
            className={direction === -1 ? 'active' : ''}
            onClick={() => setDirection(-1)}
          >
            <Minus size={16} />
            Rozchód
          </button>
        </div>
        <div className="form-grid">
          <label>
            Liczba sztuk
            <input
              type="number"
              min="1"
              max="100000"
              step="1"
              required
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            Powód
            <input
              required
              maxLength={150}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? 'Zapisywanie…' : 'Zapisz zmianę stanu'}
        </button>
      </form>
      <h3 className="section-label">Ostatnie operacje</h3>
      <div className="movements">
        {movements.slice(0, 8).map((move, index) => (
          <div key={index}>
            <span>
              {move.reason}
              <small>{dateTime(move.createdAt)}</small>
            </span>
            <strong className={move.quantity > 0 ? 'positive' : ''}>
              {move.quantity > 0 ? '+' : ''}
              {move.quantity}
            </strong>
          </div>
        ))}
      </div>
    </Modal>
  );
}
