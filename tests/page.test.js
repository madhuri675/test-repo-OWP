'use strict';

/**
 * Browser-level tests: the real index.html and app.js are loaded into a
 * simulated browser (jsdom), so these tests click the actual form, delete
 * buttons and read the actual total from the page.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pageHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const STORAGE_KEY = 'expense-tracker:expenses:v1';

let JSDOM = null;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (error) {
  JSDOM = null;
}

const withoutJsdom = JSDOM ? false : 'jsdom is not installed, so the browser tests were skipped';

/**
 * Build the page with app.js inlined. If saved data is given it is put into
 * localStorage before the app starts, which is what a page reload looks like.
 */
function buildPage(saved) {
  const seed = saved
    ? '<script>window.localStorage.setItem(' + JSON.stringify(STORAGE_KEY) + ', ' + JSON.stringify(saved) + ');</script>'
    : '';

  return pageHtml.replace(
    '<script src="app.js"></script>',
    seed + '<script>' + appSource + '</script>'
  );
}

function openPage(saved) {
  const dom = new JSDOM(buildPage(saved), {
    url: 'https://expense-tracker.test/',
    runScripts: 'dangerously'
  });

  return new Promise((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(dom);
    };

    const timer = setTimeout(finish, 3000);

    if (dom.window.document.readyState === 'complete') {
      finish();
      return;
    }

    dom.window.addEventListener('load', finish);
  });
}

function page(dom) {
  return dom.window.document;
}

function fillAndSubmit(dom, description, amount, category) {
  const document = page(dom);

  document.getElementById('description').value = description;
  document.getElementById('amount').value = amount;
  document.getElementById('category').value = category;

  document.getElementById('expense-form').dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true })
  );
}

function rows(dom) {
  return Array.from(page(dom).querySelectorAll('#expense-list tr')).map((row) => ({
    description: row.children[0].textContent.trim(),
    category: row.children[1].textContent.trim(),
    amount: row.children[2].textContent.trim()
  }));
}

function total(dom) {
  return page(dom).getElementById('total-amount').textContent.trim();
}

function message(dom) {
  return page(dom).getElementById('form-message').textContent.trim();
}

function fieldError(dom, field) {
  return page(dom).getElementById(field + '-error').textContent.trim();
}

function deleteExpense(dom, name) {
  const button = page(dom).querySelector(
    '#expense-list button[aria-label="Delete ' + name + '"]'
  );

  assert.ok(button, 'expected a delete button for ' + name);
  button.click();
}

/* ---------------------------------------------------------------- tests -- */

test('the page starts empty with a total of 0.00', { skip: withoutJsdom }, async () => {
  const dom = await openPage();

  try {
    assert.equal(rows(dom).length, 0);
    assert.equal(total(dom), '0.00');
    assert.match(page(dom).getElementById('empty-state').textContent, /No expenses yet/);
  } finally {
    dom.window.close();
  }
});

test('adding two expenses lists both and shows the total 250.00', { skip: withoutJsdom }, async () => {
  const dom = await openPage();

  try {
    fillAndSubmit(dom, 'Coffee', '50', 'Food');
    assert.match(message(dom), /Added Coffee/);

    fillAndSubmit(dom, 'Books', '200', 'Shopping');
    assert.match(message(dom), /Added Books/);

    const list = rows(dom);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], { description: 'Books', category: 'Shopping', amount: '200.00' });
    assert.deepEqual(list[1], { description: 'Coffee', category: 'Food', amount: '50.00' });
    assert.equal(total(dom), '250.00');

    assert.equal(page(dom).getElementById('description').value, '');
    assert.equal(page(dom).getElementById('amount').value, '');
  } finally {
    dom.window.close();
  }
});

test('deleting an expense removes it and updates the total', { skip: withoutJsdom }, async () => {
  const dom = await openPage();

  try {
    fillAndSubmit(dom, 'Coffee', '50', 'Food');
    fillAndSubmit(dom, 'Books', '200', 'Shopping');
    assert.equal(total(dom), '250.00');

    deleteExpense(dom, 'Coffee');

    assert.equal(rows(dom).length, 1);
    assert.equal(rows(dom)[0].description, 'Books');
    assert.equal(total(dom), '200.00');
    assert.match(message(dom), /Deleted Coffee/);

    deleteExpense(dom, 'Books');

    assert.equal(rows(dom).length, 0);
    assert.equal(total(dom), '0.00');
    assert.match(page(dom).getElementById('empty-state').textContent, /No expenses yet/);
  } finally {
    dom.window.close();
  }
});

test('an empty description is refused with a message', { skip: withoutJsdom }, async () => {
  const dom = await openPage();

  try {
    fillAndSubmit(dom, '', '50', 'Food');

    assert.equal(rows(dom).length, 0);
    assert.equal(total(dom), '0.00');
    assert.match(fieldError(dom, 'description'), /Please enter a description/);
    assert.match(message(dom), /Nothing was added/);

    fillAndSubmit(dom, '     ', '50', 'Food');

    assert.equal(rows(dom).length, 0);
    assert.match(fieldError(dom, 'description'), /Please enter a description/);
  } finally {
    dom.window.close();
  }
});

test('a negative amount is refused with a message', { skip: withoutJsdom }, async () => {
  const dom = await openPage();

  try {
    fillAndSubmit(dom, 'Refund', '-50', 'Other');

    assert.equal(rows(dom).length, 0);
    assert.equal(total(dom), '0.00');
    assert.match(fieldError(dom, 'amount'), /greater than zero/);
    assert.match(message(dom), /Nothing was added/);
  } finally {
    dom.window.close();
  }
});

test('a non-numeric amount is refused with a message', { skip: withoutJsdom }, async () => {
  const dom = await openPage();

  try {
    fillAndSubmit(dom, 'Coffee', 'abc', 'Food');

    assert.equal(rows(dom).length, 0);
    assert.equal(total(dom), '0.00');
    assert.match(fieldError(dom, 'amount'), /valid amount/);
    assert.match(message(dom), /Nothing was added/);
  } finally {
    dom.window.close();
  }
});

test('a missing category is refused with a message', { skip: withoutJsdom }, async () => {
  const dom = await openPage();

  try {
    fillAndSubmit(dom, 'Coffee', '50', '');

    assert.equal(rows(dom).length, 0);
    assert.match(fieldError(dom, 'category'), /choose a category/);
    assert.match(message(dom), /Nothing was added/);
  } finally {
    dom.window.close();
  }
});

test('expenses are still there after a reload', { skip: withoutJsdom }, async () => {
  const first = await openPage();
  let saved;

  try {
    fillAndSubmit(first, 'Coffee', '50', 'Food');
    fillAndSubmit(first, 'Books', '200', 'Shopping');
    assert.equal(total(first), '250.00');

    saved = first.window.localStorage.getItem(STORAGE_KEY);
    assert.ok(saved, 'expected the expenses to be saved');
  } finally {
    first.window.close();
  }

  const reloaded = await openPage(saved);

  try {
    const list = rows(reloaded);
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((expense) => expense.description), ['Books', 'Coffee']);
    assert.equal(total(reloaded), '250.00');
  } finally {
    reloaded.window.close();
  }
});
