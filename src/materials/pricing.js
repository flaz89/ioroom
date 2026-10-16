/*
* Prices of catalog items (materials now, furniture later). Prices are NET (VAT excluded) with their own
* VAT rate, shown as net + VAT + total everywhere (product card, bill of quantities).
* Record fields: price (net € per unit: m² for materials), vatRate (%, default DEFAULT_VAT), waste (% of
* extra material to buy: cuts, breakage).
*/
export const DEFAULT_VAT = 22; // Italian standard rate

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const formatEuro = (amount) => euro.format(amount);

// "1.234,5" / "1234.5" / "1,5" -> number; '' -> null; NaN when not a number (form fields, comma or point)
export function parseDecimal(text) {
    const trimmed = String(text ?? '').trim();
    if (trimmed === '') return null;
    // a comma is the decimal separator; points before it are thousands separators
    const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
    return Number(normalized);
}

// Number -> text for a form field, with a decimal comma ('' for null)
export const formatDecimal = (value) => (value == null ? '' : String(value).replace('.', ','));

// { net, vat, total } of `quantity` units at `price` (net) with `vatRate` %, rounded to cents
export function priceBreakdown(quantity, price, vatRate = DEFAULT_VAT) {
    const cents = (amount) => Math.round(amount * 100) / 100;
    const net = cents(quantity * price);
    const vat = cents(net * (vatRate ?? DEFAULT_VAT) / 100);
    return { net, vat, total: cents(net + vat) };
}
