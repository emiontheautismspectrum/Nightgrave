/**
 * Names and messages in Cyrillic (the same functions run on the client and in the Worker): Cyrillic names validate,
 * Russian profanity is rejected in Cyrillic, in Latin transliteration, in leetspeak and in Cyrillic / Latin look-alike
 * mixes, while ordinary Russian words and real names are NOT rejected. Length counts user-perceived characters.
 */
import { describe, expect, it } from 'vitest';
import { hasProfanity, validateMessage, validateName } from '../src/shared/text';

describe('Cyrillic names', () => {
  it('ordinary Russian names and words pass', () => {
    for (const n of ['Хлеб', 'Скука', 'Скуратов', 'Лебедев', 'Мудрый', 'Евгений', 'Оксана', 'Аркадий', 'Хулио', 'Котик', 'Ёжик', 'Пётр Ёлкин', 'Сергей_88', 'Наталья', 'Ксюша', 'Хорошист', 'Блинов', 'Asuka', 'Tsukasa', 'Rebate', 'Lebanon', 'Debate Club', 'Balance', 'Hulio', 'Shuhrat', 'Oybek', 'Dilnoza'])
      expect(validateName(n), n).toEqual({ ok: true, value: n.normalize('NFKC') });
  });

  it('Russian profanity is rejected: Cyrillic, transliterated, leet, separators, look-alike mixes, ё', () => {
    const bad = [
      'Сука', 'сука', 'С.у.к.а', 'Хуй', 'ХУЁВО', 'пиздец', 'блять', 'Ебать', 'мудак', 'пидор', 'залупа', 'шлюха', 'гандон', 'гондон', 'долбоёб', 'уёбок', 'шалава', 'дрочер',
      'huy', 'Hui', 'xuy', 'xyi', 'Xу1', 'xуй', 'pizda', 'p1zd', 'blyat', 'blya', 'suka', 's.u.k.a', 'SUKA_bot', 'Mr Suka', 'cyka', 'cука',
      'ebat', 'eban', 'ebal', 'mudak', 'pidor', 'pidar', 'zalupa', 'gandon', 'shlyuha', 'p!zd@', '5uka',
    ];
    for (const n of bad) expect(hasProfanity(n), n).toBe(true);
    expect(validateName('Сука')).toEqual({ ok: false, error: 'words' });
    expect(validateMessage('ну ты и сука')).toEqual({ ok: false, error: 'words' });
  });

  it('length counts user-perceived characters; combining marks and stacks; NFKC', () => {
    expect(validateName('Ёж')).toEqual({ ok: false, error: 'short' }); // 2 letters
    expect(validateName('Йод')).toEqual({ ok: true, value: 'Йод' });
    // И + combining breve is Й after NFKC (one character)
    expect(validateName('Йод')).toEqual({ ok: true, value: 'Йод' });
    expect(validateName('Аа́́́а')).toEqual({ ok: false, error: 'chars' }); // a zalgo stack
    expect(validateName('Ааааааааааааааааа')).toEqual({ ok: false, error: 'long' }); // 17
    expect(validateName('Аааааааааааааааа')).toEqual({ ok: true, value: 'Аааааааааааааааа' }); // 16
    expect(validateMessage('Парируй ночь, друг!')).toEqual({ ok: true, value: 'Парируй ночь, друг!' });
  });

  it('bidi overrides and zero-width characters are rejected in Cyrillic names too', () => {
    expect(validateName('Ко‮тик')).toEqual({ ok: false, error: 'chars' });
    expect(validateName('Ко​тик')).toEqual({ ok: false, error: 'chars' });
    expect(validateName('<b>Кот</b>')).toEqual({ ok: false, error: 'chars' });
  });
});
