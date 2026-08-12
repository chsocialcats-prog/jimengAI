import { esc } from "../core/format.mjs";

export function isRoleCard(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}

export function normalizeRoleCards(cards, legacyCard = null) {
  const list = Array.isArray(cards)
    ? cards
    : (isRoleCard(cards) ? [cards] : (isRoleCard(legacyCard) ? [legacyCard] : []));
  return list.filter(isRoleCard);
}

export function orderedWorkCards(work = {}) {
  const cards = normalizeRoleCards(work.cards, work.card);
  const hasCardIds = Object.prototype.hasOwnProperty.call(work, "card_ids");
  if (!hasCardIds) return cards;

  const cardIds = Array.isArray(work.card_ids)
    ? work.card_ids.map(Number).filter(Number.isFinite)
    : [];
  if (!cardIds.length || !cards.length) return [];

  const cardsById = new Map(cards.map((card) => [Number(card.id), card]));
  const usedIds = new Set();
  return cardIds.flatMap((cardId) => {
    const card = cardsById.get(cardId);
    if (!card || usedIds.has(cardId)) return [];
    usedIds.add(cardId);
    return [card];
  });
}

export function resolveSessionCards(conversation = {}, work = {}) {
  if (Array.isArray(conversation.card_snapshots)) {
    return normalizeRoleCards(conversation.card_snapshots);
  }
  const legacySnapshots = normalizeRoleCards(null, conversation.card_snapshot);
  return legacySnapshots.length ? legacySnapshots : orderedWorkCards(work);
}

export function cardSummaryText(cards = []) {
  const names = normalizeRoleCards(cards)
    .map((card) => String(card.name || "未命名角色").trim())
    .filter(Boolean);
  return names.length ? names.join("、") : "暂无角色";
}

export function roleCardSummaryHtml(cards = []) {
  const resolvedCards = normalizeRoleCards(cards);
  if (!resolvedCards.length) return '<span class="role-card-summary empty">暂无角色</span>';
  return `<span class="role-card-summary">角色：${esc(cardSummaryText(resolvedCards))}</span>`;
}

export function workCardIds(work = {}) {
  const rawIds = Array.isArray(work.card_ids)
    ? work.card_ids
    : (work.card_id === null || work.card_id === undefined || work.card_id === "" ? [] : [work.card_id]);
  return [...new Set(rawIds.map(Number).filter(Number.isFinite))];
}

export function cardPersonalitySummary(card, fallback = "尚未填写性格或人设简介。") {
  return card?.personality || card?.persona || fallback;
}
