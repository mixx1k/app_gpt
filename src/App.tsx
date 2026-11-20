import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Coffee,
  Grid2X2,
  History,
  LayoutGrid,
  Minus,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Store,
  Trash2,
  TrendingUp,
  Utensils,
  X,
} from 'lucide-react';
import { api, ApiError, dateTime, errorMessage, money } from './api';
import {
  categories,
  categoryIcons,
  Modal,
  Payment,
  ProductArt,
  ProductEditor,
  Receipt,
  StockEditor,
} from './components';
import type { CartItem, Category, Checkout, Product, Sale, Summary } from './types';

type Page = 'sale' | 'inventory' | 'history';
type Dialog =
  | { kind: 'payment' }
  | { kind: 'receipt'; sale: Sale }
  | { kind: 'product'; product: Product | null }
  | { kind: 'stock'; product: Product }
  | { kind: 'void'; sale: Sale }
  | { kind: 'help' }
  | { kind: 'clear' }
  | null;
const CART_KEY = 'mlynek.cart.v1';
const PENDING_KEY = 'mlynek.pending.v1';
const isDesktop = window.location.protocol === 'mlynek:';
function readStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
function initialCart(): CartItem[] {
  const items = readStored<unknown>(CART_KEY, []);
  return Array.isArray(items)
    ? items
        .filter(
          (item) =>
            Number.isSafeInteger(item?.productId) &&
            item.productId > 0 &&
            Number.isInteger(item?.quantity) &&
            item.quantity > 0 &&
            item.quantity <= 999,
        )
        .slice(0, 100)
    : [];
}

export default function App() {
  const [page, setPage] = useState<Page>('sale');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cart, setCart] = useState<CartItem[]>(initialCart);
  const [category, setCategory] = useState<Category | 'Wszystko'>('Wszystko');
  const [search, setSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [table, setTable] = useState('');
  const [note, setNote] = useState('');
  const [discount, setDiscount] = useState(0);
  const [showDiscount, setShowDiscount] = useState(false);
  const [pending, setPending] = useState<Checkout | null>(() => readStored(PENDING_KEY, null));
  const [dialog, setDialog] = useState<Dialog>(() =>
    readStored(PENDING_KEY, null) ? { kind: 'payment' } : null,
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [toast, setToast] = useState('');
  const submitting = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [menu, history, totals] = await Promise.all([
        api<Product[]>('/products'),
        api<Sale[]>('/sales'),
        api<Summary>('/summary'),
      ]);
      setProducts(menu);
      setSales(history);
      setSummary(totals);
      setConnected(true);
      setLoadError('');
    } catch (error) {
      setConnected(false);
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      setToast('Przeglądarka nie może zapisać koszyka. Nie zamykaj tej karty.');
    }
  }, [cart]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const lines = cart
    .map((item) => ({
      ...item,
      product: products.find((product) => product.id === item.productId),
    }))
    .filter((item): item is CartItem & { product: Product } => Boolean(item.product));
  const subtotal = lines.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
  const discountCents = Math.round((subtotal * discount) / 100);
  const total = subtotal - discountCents;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const invalidCart =
    lines.length !== cart.length || lines.some((item) => item.quantity > item.product.stock);
  const filtered = products.filter(
    (product) =>
      (page === 'inventory' || category === 'Wszystko' || product.category === category) &&
      product.name.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')),
  );
  const filteredSales = sales.filter((sale) =>
    `${sale.number} ${sale.tableNumber ?? ''} ${sale.note}`
      .toLocaleLowerCase('pl')
      .includes(historySearch.toLocaleLowerCase('pl')),
  );
  const draft = {
    items: lines.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      expectedPriceCents: item.product.priceCents,
    })),
    discountPercent: discount,
    orderType,
    tableNumber: table ? Number(table) : null,
    note,
  };

  function navigate(next: Page) {
    setPage(next);
    setSearch('');
  }
  function add(product: Product) {
    if (pending) return;
    const count = cart.find((item) => item.productId === product.id)?.quantity ?? 0;
    if (count >= product.stock || count >= 999) {
      setToast('Osiągnięto maksymalną dostępną ilość.');
      return;
    }
    setCart((previous) =>
      count
        ? previous.map((item) =>
            item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item,
          )
        : [...previous, { productId: product.id, quantity: 1 }],
    );
  }
  function decrease(id: number) {
    if (!pending)
      setCart((previous) =>
        previous
          .map((item) => (item.productId === id ? { ...item, quantity: item.quantity - 1 } : item))
          .filter((item) => item.quantity > 0),
      );
  }
  function clearCart() {
    setCart([]);
    setDiscount(0);
    setShowDiscount(false);
    setNote('');
    setTable('');
    setDialog(null);
  }
  function openPayment() {
    setOperationError('');
    setDialog({ kind: 'payment' });
  }
  async function pay(method: 'cash' | 'card', cash: number | null) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setOperationError('');
    const checkout: Checkout = pending || {
      ...draft,
      requestId: crypto.randomUUID(),
      paymentMethod: method,
      cashReceivedCents: cash,
    };
    try {
      // Persist the attempt before sending it, including its immutable idempotency key.
      localStorage.setItem(PENDING_KEY, JSON.stringify(checkout));
      setPending(checkout);
      const sale = await api<Sale>('/sales', { method: 'POST', body: JSON.stringify(checkout) });
      localStorage.removeItem(PENDING_KEY);
      setPending(null);
      setCart([]);
      setDiscount(0);
      setNote('');
      setTable('');
      setShowDiscount(false);
      setDialog({ kind: 'receipt', sale });
      setToast(`Zapisano zamówienie ${sale.number}`);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        localStorage.removeItem(PENDING_KEY);
        setPending(null);
        void refresh();
      }
      setOperationError(errorMessage(error));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  async function cancelSale(sale: Sale) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setOperationError('');
    try {
      const updated = await api<Sale>(`/sales/${sale.id}/void`, { method: 'POST', body: '{}' });
      setDialog({ kind: 'receipt', sale: updated });
      setToast('Sprzedaż anulowana. Przywrócono stan magazynowy.');
      await refresh();
    } catch (error) {
      setOperationError(errorMessage(error));
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  const dateLabel = new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('sale');
          }}
          className="brand"
        >
          <span className="brand-icon">
            <Coffee strokeWidth={1.7} />
          </span>
          <span>
            młynek<span className="brand-dot">.</span>
            <small>TWÓJ CODZIENNY POS</small>
          </span>
        </a>
        <div className="workspace-label">PRZESTRZEŃ KAWIARNI</div>
        <nav aria-label="Nawigacja główna">
          <button className={page === 'sale' ? 'active' : ''} onClick={() => navigate('sale')}>
            <LayoutGrid size={19} />
            <span>Sprzedaż</span>
            <ChevronRight size={16} />
          </button>
          <button
            className={page === 'inventory' ? 'active' : ''}
            onClick={() => navigate('inventory')}
          >
            <Package size={19} />
            <span>Menu i magazyn</span>
          </button>
          <button
            className={page === 'history' ? 'active' : ''}
            onClick={() => navigate('history')}
          >
            <History size={19} />
            <span>Historia zamówień</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="cafe-note">
            <Sparkles size={19} />
            <strong>
              Małe rytuały.
              <br />
              Dobra kawa.
            </strong>
            <p>Wszystko, czego potrzebujesz przy swoim kontuarze.</p>
          </div>
          <button className="help-button" onClick={() => setDialog({ kind: 'help' })}>
            <CircleHelp size={18} />
            Jak to działa?
            <ArrowRight size={16} />
          </button>
          <div className="operator">
            <span>MK</span>
            <div>
              <strong>Moja kawiarnia</strong>
              <small>Stanowisko 01</small>
            </div>
            <span className={`status-dot ${connected ? 'online' : ''}`} />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Moja kawiarnia</span>
            <ChevronRight size={14} />
            <strong>
              {page === 'sale'
                ? 'Sprzedaż'
                : page === 'inventory'
                  ? 'Menu i magazyn'
                  : 'Historia zamówień'}
            </strong>
          </div>
          <div>
            <span className="date-label">{dateLabel}</span>
            <span className={`connection ${connected ? '' : 'offline'}`}>
              <i />
              {connected ? 'Połączono' : 'Brak połączenia'}
            </span>
            <span className="top-avatar">MK</span>
          </div>
        </header>
        {loadError && (
          <div className="connection-banner" role="alert">
            <span>{loadError}</span>
            <button onClick={() => void refresh()}>
              <RefreshCw size={15} />
              Ponów połączenie
            </button>
          </div>
        )}
        <div className={`work-area ${page === 'sale' ? 'with-cart' : ''}`}>
          <main className="main-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {page === 'sale'
                    ? 'DOBRY DZIEŃ ZACZYNA SIĘ TUTAJ'
                    : page === 'inventory'
                      ? 'WSZYSTKO NA SWOIM MIEJSCU'
                      : 'KAŻDE ZAMÓWIENIE POD KONTROLĄ'}
                </div>
                <h1>
                  {page === 'sale'
                    ? 'Przyjmij zamówienie'
                    : page === 'inventory'
                      ? 'Menu i magazyn'
                      : 'Historia zamówień'}
                </h1>
                <p>
                  {page === 'sale'
                    ? 'Co dobrego dziś podajemy?'
                    : page === 'inventory'
                      ? 'Twoje produkty, ceny i dostępne porcje.'
                      : 'Przeglądaj rachunki i szczegóły sprzedaży.'}
                </p>
              </div>
              {page === 'inventory' ? (
                <button
                  className="primary"
                  onClick={() => setDialog({ kind: 'product', product: null })}
                >
                  <Plus size={18} />
                  Dodaj produkt
                </button>
              ) : (
                <div className="heading-icon">
                  <Coffee size={27} strokeWidth={1.4} />
                </div>
              )}
            </div>
            <div className="stats">
              <div className="stat">
                <span className="stat-icon">
                  <TrendingUp size={19} />
                </span>
                <div>
                  <span>Sprzedaż dzisiaj</span>
                  <strong>{summary ? money(summary.revenueCents) : '—'}</strong>
                </div>
              </div>
              <div className="stat">
                <span className="stat-icon peach">
                  <ReceiptText size={19} />
                </span>
                <div>
                  <span>Zamówienia</span>
                  <strong>
                    {summary?.orders ?? '—'}
                    <small>dzisiaj</small>
                  </strong>
                </div>
              </div>
              <div className="stat">
                <span className="stat-icon lavender">
                  <ShoppingBag size={19} />
                </span>
                <div>
                  <span>Średni rachunek</span>
                  <strong>{summary ? money(summary.averageCents) : '—'}</strong>
                </div>
              </div>
            </div>
            {page !== 'history' && (
              <>
                <div className="catalog-toolbar">
                  <div className="search-input">
                    <Search size={19} />
                    <input
                      aria-label="Szukaj produktu"
                      placeholder="Szukaj kawy, wypieku, czegoś dobrego…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    {search && (
                      <button
                        className="icon-button"
                        aria-label="Wyczyść wyszukiwanie"
                        onClick={() => setSearch('')}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <span className="product-count">{filtered.length} produktów</span>
                </div>
                {page === 'sale' && (
                  <div className="categories" aria-label="Kategorie menu">
                    <button
                      className={category === 'Wszystko' ? 'selected' : ''}
                      onClick={() => setCategory('Wszystko')}
                    >
                      <Grid2X2 size={17} />
                      Wszystko<span>{products.length}</span>
                    </button>
                    {categories.map((name) => {
                      const Icon = categoryIcons[name];
                      return (
                        <button
                          key={name}
                          className={category === name ? 'selected' : ''}
                          onClick={() => setCategory(name)}
                        >
                          <Icon size={18} />
                          {name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {loading ? (
                  <div className="empty-state">
                    <RefreshCw className="spin" />
                    <h3>Przygotowujemy menu…</h3>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="empty-state">
                    <Search size={35} />
                    <h3>Nie znaleziono produktów</h3>
                    <p>Zmień wyszukiwanie lub dodaj produkt do menu.</p>
                    <button
                      className="secondary"
                      onClick={() => {
                        setSearch('');
                        setCategory('Wszystko');
                      }}
                    >
                      Pokaż całe menu
                    </button>
                  </div>
                ) : page === 'sale' ? (
                  <div className="product-grid">
                    {filtered.map((product) => {
                      const quantity =
                        cart.find((item) => item.productId === product.id)?.quantity ?? 0;
                      return (
                        <button
                          className={`product-card ${quantity ? 'in-cart' : ''}`}
                          key={product.id}
                          aria-label={`Dodaj ${product.name}`}
                          disabled={
                            product.stock === 0 ||
                            quantity >= product.stock ||
                            quantity >= 999 ||
                            Boolean(pending)
                          }
                          onClick={() => add(product)}
                        >
                          <div className="product-image">
                            <ProductArt product={product} />
                            {quantity > 0 && (
                              <span className="quantity-badge">{quantity} w koszyku</span>
                            )}
                            {product.stock <= 8 && (
                              <span
                                className={`stock-badge ${product.stock === 0 ? 'sold-out' : ''}`}
                              >
                                {product.stock === 0
                                  ? 'Wyprzedane'
                                  : `Ostatnie ${product.stock} szt.`}
                              </span>
                            )}
                          </div>
                          <div className="product-info">
                            <span>{product.category}</span>
                            <h3>{product.name}</h3>
                            <div>
                              <strong>{money(product.priceCents)}</strong>
                              <span className="add-product">
                                <Plus size={18} />
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Produkt</th>
                          <th>Cena brutto</th>
                          <th>VAT</th>
                          <th>Dostępność</th>
                          <th>
                            <span className="sr-only">Działania</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((product) => (
                          <tr key={product.id}>
                            <td>
                              <div className="table-product">
                                <ProductArt product={product} small />
                                <span>
                                  <strong>{product.name}</strong>
                                  <small>{product.category}</small>
                                </span>
                              </div>
                            </td>
                            <td>{money(product.priceCents)}</td>
                            <td>{product.vatRate}%</td>
                            <td>
                              <span className={`inventory-stock ${product.stock < 9 ? 'low' : ''}`}>
                                {product.stock} szt.
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className="icon-button"
                                  title="Edytuj produkt"
                                  aria-label={`Edytuj ${product.name}`}
                                  onClick={() => setDialog({ kind: 'product', product })}
                                >
                                  <Pencil size={17} />
                                </button>
                                <button
                                  className="secondary compact"
                                  onClick={() => setDialog({ kind: 'stock', product })}
                                >
                                  <ArrowDownLeft size={16} />
                                  Stan
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {page === 'history' && (
              <>
                <div className="catalog-toolbar">
                  <div className="search-input">
                    <Search size={19} />
                    <input
                      aria-label="Szukaj zamówienia"
                      placeholder="Szukaj po numerze, stoliku lub uwagach…"
                      value={historySearch}
                      onChange={(event) => setHistorySearch(event.target.value)}
                    />
                  </div>
                  <span className="product-count">Ostatnie 100 zamówień</span>
                </div>
                {filteredSales.length === 0 ? (
                  <div className="empty-state">
                    <ReceiptText size={42} />
                    <h3>
                      {sales.length
                        ? 'Nie znaleziono zamówień'
                        : 'Pierwsza kawa jeszcze przed nami'}
                    </h3>
                    <p>
                      {sales.length
                        ? 'Zmień wyszukiwane hasło.'
                        : 'Zrealizowane zamówienia pojawią się tutaj.'}
                    </p>
                    <button className="secondary" onClick={() => navigate('sale')}>
                      Przejdź do sprzedaży
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Zamówienie</th>
                          <th>Data</th>
                          <th>Obsługa</th>
                          <th>Płatność</th>
                          <th>Razem</th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSales.map((sale) => (
                          <tr key={sale.id}>
                            <td>
                              <strong>{sale.number}</strong>
                            </td>
                            <td>{dateTime(sale.createdAt)}</td>
                            <td>
                              {sale.orderType === 'takeaway'
                                ? 'Na wynos'
                                : sale.tableNumber
                                  ? `Stolik ${sale.tableNumber}`
                                  : 'Na miejscu'}
                            </td>
                            <td>{sale.paymentMethod === 'cash' ? 'Gotówka' : 'Karta'}</td>
                            <td>
                              <strong>{money(sale.totalCents)}</strong>
                            </td>
                            <td>
                              <span className={`sale-status ${sale.status}`}>
                                {sale.status === 'completed' ? 'Opłacone' : 'Anulowane'}
                              </span>
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                aria-label={`Szczegóły ${sale.number}`}
                                onClick={() => setDialog({ kind: 'receipt', sale })}
                              >
                                <ChevronRight size={19} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <footer className="content-footer">
              <span>
                <Coffee size={14} />
                Zrobione z myślą o dobrym dniu.
              </span>
              <span>
                Młynek POS <b>·</b> {isDesktop ? 'wersja PC' : 'wersja demonstracyjna'}
              </span>
            </footer>
          </main>
          {page === 'sale' && (
            <aside className="cart-panel" aria-label="Bieżące zamówienie">
              <div className="cart-header">
                <div>
                  <h2>
                    Nowe zamówienie<span>{itemCount}</span>
                  </h2>
                  <p>Każdy szczegół ma znaczenie</p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Wyczyść koszyk"
                  disabled={!cart.length || Boolean(pending)}
                  onClick={() => setDialog({ kind: 'clear' })}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="order-settings">
                <div className="segmented">
                  <button
                    className={orderType === 'dine_in' ? 'active' : ''}
                    disabled={Boolean(pending)}
                    onClick={() => setOrderType('dine_in')}
                  >
                    <Utensils size={16} />
                    Na miejscu
                  </button>
                  <button
                    className={orderType === 'takeaway' ? 'active' : ''}
                    disabled={Boolean(pending)}
                    onClick={() => setOrderType('takeaway')}
                  >
                    <ShoppingBag size={16} />
                    Na wynos
                  </button>
                </div>
                {orderType === 'dine_in' && (
                  <label className="table-select">
                    <Store size={16} />
                    <span>Stolik</span>
                    <select
                      aria-label="Numer stolika"
                      value={table}
                      disabled={Boolean(pending)}
                      onChange={(event) => setTable(event.target.value)}
                    >
                      <option value="">Bez numeru</option>
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {String(i + 1).padStart(2, '0')}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="cart-items">
                {cart.length === 0 ? (
                  <div className="empty-cart">
                    <div>
                      <ShoppingBasket size={41} strokeWidth={1.3} />
                      <span>
                        <Plus size={15} />
                      </span>
                    </div>
                    <h3>Tu zaczyna się coś dobrego</h3>
                    <p>
                      Wybierz produkty z menu,
                      <br />
                      aby rozpocząć zamówienie.
                    </p>
                    <span className="empty-cart-line" />
                  </div>
                ) : (
                  <>
                    {cart.map((item) => {
                      const product = products.find((p) => p.id === item.productId);
                      return product ? (
                        <div className="cart-item" key={item.productId}>
                          <ProductArt product={product} small />
                          <div className="cart-item-info">
                            <strong>{product.name}</strong>
                            <span>{money(product.priceCents)} / szt.</span>
                            <div className="quantity-control">
                              <button
                                aria-label={`Zmniejsz ${product.name}`}
                                disabled={Boolean(pending)}
                                onClick={() => decrease(product.id)}
                              >
                                <Minus size={13} />
                              </button>
                              <span>{item.quantity}</span>
                              <button
                                aria-label={`Zwiększ ${product.name}`}
                                disabled={
                                  item.quantity >= product.stock ||
                                  item.quantity >= 999 ||
                                  Boolean(pending)
                                }
                                onClick={() => add(product)}
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                            {item.quantity > product.stock && (
                              <small className="danger">Dostępne tylko {product.stock} szt.</small>
                            )}
                          </div>
                          <strong className="line-total">
                            {money(product.priceCents * item.quantity)}
                          </strong>
                        </div>
                      ) : (
                        <div className="error-box" key={item.productId}>
                          Produkt jest niedostępny.
                          <button
                            disabled={Boolean(pending)}
                            onClick={() =>
                              setCart((old) =>
                                old.filter((line) => line.productId !== item.productId),
                              )
                            }
                          >
                            Usuń z koszyka
                          </button>
                        </div>
                      );
                    })}
                    <label className="order-note">
                      <Pencil size={15} />
                      <textarea
                        aria-label="Uwagi do zamówienia"
                        placeholder="Dodaj uwagę, np. kawa bez cukru…"
                        maxLength={300}
                        value={note}
                        disabled={Boolean(pending)}
                        onChange={(event) => setNote(event.target.value)}
                        rows={2}
                      />
                    </label>
                  </>
                )}
              </div>
              <div className="cart-bottom">
                <button
                  className="discount-button"
                  disabled={Boolean(pending)}
                  onClick={() => setShowDiscount(!showDiscount)}
                >
                  <SlidersHorizontal size={16} />
                  {discount ? `Rabat ${discount}%` : 'Dodaj rabat'}
                  <Plus size={15} />
                </button>
                {showDiscount && (
                  <label className="discount-field">
                    Rabat (%)
                    <input
                      aria-label="Rabat procentowy"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={discount}
                      disabled={Boolean(pending)}
                      onChange={(event) =>
                        setDiscount(
                          Math.min(100, Math.max(0, Math.trunc(Number(event.target.value)))),
                        )
                      }
                    />
                  </label>
                )}
                <div className="cart-summary">
                  <div>
                    <span>Suma produktów</span>
                    <span>{money(subtotal)}</span>
                  </div>
                  {discount > 0 && (
                    <div>
                      <span>Rabat {discount}%</span>
                      <span>−{money(discountCents)}</span>
                    </div>
                  )}
                  <div className="cart-total">
                    <span>Do zapłaty</span>
                    <strong>{money(total)}</strong>
                  </div>
                  <small>Ceny brutto · VAT wliczony w cenę</small>
                </div>
                <button
                  className="checkout-button"
                  disabled={!cart.length || invalidCart || !connected || loading}
                  onClick={openPayment}
                >
                  <span>Przejdź do płatności</span>
                  <ArrowRight size={20} />
                </button>
                <p className="cart-hint">
                  <span className="status-dot online" />
                  Koszyk zapisuje się na tym urządzeniu
                </p>
              </div>
            </aside>
          )}
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button aria-label="Zamknij komunikat" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {dialog?.kind === 'payment' && (
        <Payment
          draft={draft}
          pending={pending}
          busy={busy}
          error={operationError}
          onPay={pay}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'receipt' && (
        <Receipt
          sale={dialog.sale}
          onClose={() => setDialog(null)}
          onVoid={() => {
            setOperationError('');
            setDialog({ kind: 'void', sale: dialog.sale });
          }}
        />
      )}
      {dialog?.kind === 'product' && (
        <ProductEditor
          product={dialog.product}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setToast('Zapisano produkt.');
            void refresh();
          }}
        />
      )}
      {dialog?.kind === 'stock' && (
        <StockEditor
          product={dialog.product}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setToast('Zaktualizowano magazyn.');
            void refresh();
          }}
        />
      )}
      {dialog?.kind === 'void' && (
        <Modal
          title="Anulować sprzedaż?"
          onClose={() => setDialog({ kind: 'receipt', sale: dialog.sale })}
          locked={busy}
        >
          <p>
            Zamówienie <strong>{dialog.sale.number}</strong> na kwotę{' '}
            <strong>{money(dialog.sale.totalCents)}</strong> zostanie oznaczone jako anulowane.
            Wszystkie produkty wrócą do magazynu.
          </p>
          <p className="info-box">
            Aplikacja nie zwraca pieniędzy. Zwrot gotówki lub płatności na terminalu wykonaj osobno.
            Jeśli produkty zostały zużyte, skoryguj ich stan w magazynie.
          </p>
          {operationError && (
            <p role="alert" className="error-box">
              {operationError}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setDialog({ kind: 'receipt', sale: dialog.sale })}
            >
              Wróć
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() => void cancelSale(dialog.sale)}
            >
              {busy ? 'Anulowanie…' : 'Anuluj sprzedaż'}
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'clear' && (
        <Modal title="Wyczyścić koszyk?" onClose={() => setDialog(null)}>
          <p>Usuniesz wszystkie pozycje i uwagi z bieżącego zamówienia.</p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Zachowaj
            </button>
            <button className="danger-button" onClick={clearCart}>
              Wyczyść koszyk
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'help' && (
        <Modal title="Twój pierwszy dzień z Młynkiem" onClose={() => setDialog(null)}>
          <ol className="help-steps">
            <li>Wybierz produkty z menu, ustaw stolik lub opcję na wynos.</li>
            <li>Dodaj uwagi i ewentualny rabat, następnie rozlicz zamówienie.</li>
            <li>Potwierdź otrzymanie gotówki lub płatność na zewnętrznym terminalu.</li>
            <li>W historii znajdziesz potwierdzenia oraz anulowanie sprzedaży.</li>
          </ol>
          <p className="info-box">
            Menu i stany są przykładowe. Magazyn liczy gotowe produkty i porcje.{' '}
            {isDesktop
              ? 'Menu i sprzedaż działają na tym komputerze bez Internetu. Kopię bazy zapiszesz w menu Plik → Utwórz kopię zapasową.'
              : 'Sprzedaż wymaga połączenia z serwerem; sam koszyk zachowuje się w przeglądarce.'}
          </p>
          <p className="fine-print">
            To wersja demonstracyjna dla jednego stanowiska. Nie wystawia paragonów fiskalnych i nie
            obsługuje logowania pracowników.
          </p>
          <button className="primary full" onClick={() => setDialog(null)}>
            Zaczynamy
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
    </div>
  );
}
