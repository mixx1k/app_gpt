export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new ApiError('Brak połączenia z serwerem. Sprawdź połączenie i spróbuj ponownie.', 0);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError('Serwer zwrócił nieprawidłową odpowiedź.', 502);
  }
  if (!response.ok)
    throw new ApiError(data.error || 'Nie udało się wykonać operacji.', response.status);
  return data as T;
}

export const money = (cents: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(cents / 100);
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
export function parseMoney(value: string): number | null {
  if (!/^\d{1,8}([.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd.';
