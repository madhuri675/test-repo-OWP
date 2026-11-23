'use strict';

/**
 * Automated tests for the Expense Tracker logic.
 * No browser and no dependencies are needed: app.js exports its functions
 * when it is loaded by Node.js.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const app = require(path.join(__dirname, '..', 'app.js'));

const validate = app.validate;
const parseAmount = app.parseAmount;
const formatAmount = app.formatAmount;
const createStore = app.createStore;
const STORAGE_KEY = app.STORAGE_KEY;

/**
 * A stand-in for localStorage that behaves like the real one closely
 * enough: values are kept as strings and a missing key returns null.
 */
function memoryStorage(options) {
  const settings = options || {};
  const data = new Map();

  return {
    getItem(key) {
      if (settings.failReads) {
        throw new Error('storage blocked');
      }
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (settings.failWrites) {
        throw new Error('storage full');
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
}

/* --------------------------------------------------------- validation -- */

test('a valid expense is accepted and rounded to cents', () => {
  const result = validate({ description: 'Coffee', amount: '50', category: 'Food' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { description: 'Coffee', amount: 50, category: 'Food' });

  const withDecimals = validate({ description: 'Juice', amount: '3.456', category: 'Food' });
  assert.equal(withDecimals.value.amount, 3.46);
});

test('extra spaces in the description are tidied up', () => {
  const result = validate({ description: '  Coffee   with   team  ', amount: '50', category: 'Food' });

  assert.equal(result.ok, true);
  assert.equal(result.value.description, 'Coffee with team');
});

test('an empty description is rejected', () => {
  const result = validate({ description: '', amount: '50', category: 'Food' });

  assert.equal(result.ok, false);
  assert.match(result.errors.description, /Please enter a description/);
  assert.equal(result.errors.amount, undefined);
});

test('a description of only spaces is rejected', () => {
  const result = validate({ description: '     ', amount: '50', category: 'Food' });

  assert.equal(result.ok, false);
  assert.match(result.errors.description, /Please enter a description/);
});

test('a very long description is rejected', () => {
  const result = validate({ description: 'a'.repeat(81), amount: '50', category: 'Food' });

  assert.equal(result.ok, false);
  assert.match(result.errors.description, /80 characters/);
});

test('a non-numeric amount is rejected', () => {
  ['abc', 'ten', '', '12.3.4', '1e5', '--5', ' '].forEach((amount) => {
    const result = validate({ description: 'Coffee', amount: amount, category: 'Food' });

    assert.equal(result.ok, false, 'expected ' + JSON.stringify(amount) + ' to be rejected');
    assert.match(result.errors.amount, /valid amount/);
  });
});

test('a negative amount is rejected', () => {
  ['-50', '-0.01', -12].forEach((amount) => {
    const result = validate({ description: 'Coffee', amount: amount, category: 'Food' });

    assert.equal(result.ok, false, 'expected ' + JSON.stringify(amount) + ' to be rejected');
    assert.match(result.errors.amount, /greater than zero/);
  });
});

test('a zero amount is rejected', () => {
  ['0', '0.00', 0].forEach((amount) => {
    const result = validate({ description: 'Coffee', amount: amount, category: 'Food' });

    assert.equal(result.ok, false, 'expected ' + JSON.stringify(amount) + ' to be rejected');
    assert.match(result.errors.amount, /greater than zero/);
  });
});

test('an absurdly large amount is rejected', () => {
  const result = validate({ description: 'Coffee', amount: '1000000001', category: 'Food' });

  assert.equal(result.ok, false);
  assert.match(result.errors.amount, /too large/);
});

test('a missing or unknown category is rejected', () => {
  const missing = validate({ description: 'Coffee', amount: '50' });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.category, /choose a category/);

  const unknown = validate({ description: 'Coffee', amount: '50', category: 'Spaceships' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.category, /choose a category/);
});

test('several problems are reported together', () => {
  const result = validate({ description: '', amount: '-5', category: '' });

  assert.equal(result.ok, false);
  assert.ok(result.errors.description);
  assert.ok(result.errors.amount);
  assert.ok(result.errors.category);
});

/* -------------------------------------------------------------- store -- */

test('adding an expense keeps it and updates the total', () => {
  const store = createStore(memoryStorage());

  assert.equal(store.all().length, 0);
  assert.equal(store.total(), 0);

  const result = store.add({ description: 'Coffee', amount: '50', category: 'Food' });

  assert.equal(result.ok, true);
  assert.equal(result.expense.description, 'Coffee');
  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].description, 'Coffee');
  assert.equal(store.total(), 50);
});

test('the total adds up across more than one expense', () => {
  const store = createStore(memoryStorage());

  store.add({ description: 'Coffee', amount: '50', category: 'Food' });
  store.add({ description: 'Books', amount: '200', category: 'Shopping' });

  assert.equal(store.all().length, 2);
  assert.equal(store.total(), 250);

  store.add({ description: 'Pen', amount: '0.25', category: 'Other' });
  assert.equal(store.total(), 250.25);
});

test('an invalid submission adds nothing', () => {
  const store = createStore(memoryStorage());
  store.add({ description: 'Coffee', amount: '50', category: 'Food' });

  const before = store.total();
  const result = store.add({ description: '', amount: '-5', category: 'Food' });

  assert.equal(result.ok, false);
  assert.equal(store.all().length, 1);
  assert.equal(store.total(), before);
});

test('removing an expense deletes it and updates the total', () => {
  const store = createStore(memoryStorage());

  const coffee = store.add({ description: 'Coffee', amount: '50', category: 'Food' }).expense;
  const books = store.add({ description: 'Books', amount: '200', category: 'Shopping' }).expense;

  assert.equal(store.total(), 250);

  const removed = store.remove(coffee.id);
  assert.equal(removed.description, 'Coffee');
  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].id, books.id);
  assert.equal(store.total(), 200);

  store.remove(books.id);
  assert.equal(store.all().length, 0);
  assert.equal(store.total(), 0);
});

test('removing something that is not there changes nothing', () => {
  const store = createStore(memoryStorage());
  store.add({ description: 'Coffee', amount: '50', category: 'Food' });

  assert.equal(store.remove('no-such-id'), null);
  assert.equal(store.all().length, 1);
  assert.equal(store.total(), 50);
});

/* ---------------------------------------------------------- persisting -- */

test('expenses are saved and restored by a new store (a reload)', () => {
  const storage = memoryStorage();

  const first = createStore(storage);
  first.add({ description: 'Coffee', amount: '50', category: 'Food' });
  first.add({ description: 'Books', amount: '200', category: 'Shopping' });

  const second = createStore(storage);

  assert.equal(second.all().length, 2);
  assert.equal(second.total(), 250);
  assert.deepEqual(second.all().map((expense) => expense.description), ['Coffee', 'Books']);
});

test('saved expenses keep their id, amount, category and date', () => {
  const storage = memoryStorage();
  const added = createStore(storage).add({
    description: 'Books',
    amount: '199.99',
    category: 'Shopping'
  }).expense;

  const restored = createStore(storage).all()[0];

  assert.equal(restored.id, added.id);
  assert.equal(restored.amount, 199.99);
  assert.equal(restored.category, 'Shopping');
  assert.equal(restored.createdAt, added.createdAt);
});

test('reload picks up expenses saved somewhere else', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.add({ description: 'Coffee', amount: '50', category: 'Food' });

  storage.setItem(STORAGE_KEY, JSON.stringify([
    { id: 'a', description: 'Taxi', amount: 30, category: 'Transport' },
    { id: 'b', description: 'Lunch', amount: 20, category: 'Food' }
  ]));

  const reloaded = store.reload();

  assert.equal(reloaded.length, 2);
  assert.equal(store.total(), 50);
});

test('broken saved data is ignored instead of crashing', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{this is not json');

  const store = createStore(storage);

  assert.equal(store.all().length, 0);
  assert.equal(store.total(), 0);

  const result = store.add({ description: 'Coffee', amount: '50', category: 'Food' });
  assert.equal(result.ok, true);
  assert.equal(store.total(), 50);
});

test('saved records with missing or bad values are dropped', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify([
    { id: 'ok', description: 'Coffee', amount: 50, category: 'Food' },
    { id: 'no-description', description: '', amount: 10, category: 'Food' },
    { id: 'bad-amount', description: 'Taxi', amount: 'abc', category: 'Transport' },
    { id: 'negative', description: 'Refund', amount: -5, category: 'Other' },
    null,
    'nonsense'
  ]));

  const store = createStore(storage);

  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].description, 'Coffee');
  assert.equal(store.total(), 50);
});

test('storage that refuses writes still lets expenses be added', () => {
  const store = createStore(memoryStorage({ failWrites: true }));

  const result = store.add({ description: 'Coffee', amount: '50', category: 'Food' });

  assert.equal(result.ok, true);
  assert.equal(store.all().length, 1);
  assert.equal(store.total(), 50);
});

test('storage that refuses reads starts with an empty list', () => {
  const store = createStore(memoryStorage({ failReads: true }));

  assert.equal(store.all().length, 0);
  assert.equal(store.total(), 0);
});

/* ------------------------------------------------------------ amounts -- */

test('amounts are read and displayed in a friendly way', () => {
  assert.equal(parseAmount('50'), 50);
  assert.equal(parseAmount(' 1 234.50 '), 1234.5);
  assert.equal(parseAmount('1,234.50'), 1234.5);
  assert.ok(Number.isNaN(parseAmount('abc')));

  assert.equal(formatAmount(250), '250.00');
  assert.equal(formatAmount(1234.5), '1,234.50');
  assert.equal(formatAmount(0.5), '0.50');
});
