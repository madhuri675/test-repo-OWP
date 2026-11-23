/**
 * Expense Tracker
 *
 * Plain JavaScript, no build step and no dependencies.
 * The same file runs in the browser (it wires up the page when a document is
 * present) and in Node.js (it exports its functions so the tests can use them).
 */
(function (root, factory) {
  'use strict';

  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  root.ExpenseTracker = api;

  if (root.document) {
    var start = function () {
      api.init(root.document, root.localStorage);
    };

    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'expense-tracker:expenses:v1';
  var CATEGORIES = ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Other'];
  var MAX_DESCRIPTION_LENGTH = 80;
  var MAX_AMOUNT = 1000000000;

  /* ------------------------------------------------------------- helpers -- */

  function roundToCents(value) {
    return Math.round(value * 100) / 100;
  }

  function formatAmount(value) {
    var parts = roundToCents(Math.abs(value)).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function parseAmount(raw) {
    if (typeof raw === 'number') {
      return isFinite(raw) ? raw : NaN;
    }

    if (typeof raw !== 'string') {
      return NaN;
    }

    var cleaned = raw.trim().replace(/\s+/g, '').replace(/,/g, '');

    if (cleaned === '' || !/^[+-]?\d+(\.\d+)?$/.test(cleaned)) {
      return NaN;
    }

    var value = Number(cleaned);
    return isFinite(value) ? value : NaN;
  }

  function normaliseDescription(raw) {
    if (typeof raw !== 'string') {
      return '';
    }
    return raw.replace(/\s+/g, ' ').trim();
  }

  function createId() {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------------------------------------------------------- validation -- */

  /**
   * Checks one expense form submission.
   * Returns {ok: true, value: {...}} or {ok: false, errors: {field: message}}.
   */
  function validate(input) {
    var source = input || {};
    var errors = {};

    var description = normaliseDescription(source.description);

    if (description === '') {
      errors.description = 'Please enter a description.';
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
      errors.description =
        'Please keep the description to ' + MAX_DESCRIPTION_LENGTH + ' characters or fewer.';
    }

    var amount = parseAmount(source.amount);

    if (isNaN(amount)) {
      errors.amount = 'Please enter a valid amount, for example 12.50.';
    } else if (amount <= 0) {
      errors.amount = 'Amount must be greater than zero.';
    } else if (amount > MAX_AMOUNT) {
      errors.amount = 'That amount is too large. Please enter a smaller one.';
    }

    var category = typeof source.category === 'string' ? source.category.trim() : '';

    if (CATEGORIES.indexOf(category) === -1) {
      errors.category = 'Please choose a category.';
    }

    if (Object.keys(errors).length > 0) {
      return { ok: false, errors: errors };
    }

    return {
      ok: true,
      value: {
        description: description,
        amount: roundToCents(amount),
        category: category
      }
    };
  }

  /* ------------------------------------------------------------- storage -- */

  function sanitiseRecords(records) {
    if (!Array.isArray(records)) {
      return [];
    }

    var clean = [];

    records.forEach(function (record) {
      if (!record || typeof record !== 'object') {
        return;
      }

      var description = normaliseDescription(record.description);
      var amount = parseAmount(record.amount);

      if (description === '' || isNaN(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        return;
      }

      clean.push({
        id: typeof record.id === 'string' && record.id !== '' ? record.id : createId(),
        description: description,
        amount: roundToCents(amount),
        category: CATEGORIES.indexOf(record.category) === -1 ? 'Other' : record.category,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
      });
    });

    return clean;
  }

  function readRecords(storage, key) {
    var raw = null;

    try {
      raw = storage ? storage.getItem(key) : null;
    } catch (error) {
      return [];
    }

    if (typeof raw !== 'string' || raw === '') {
      return [];
    }

    try {
      return sanitiseRecords(JSON.parse(raw));
    } catch (error) {
      return [];
    }
  }

  function writeRecords(storage, key, records) {
    try {
      if (storage) {
        storage.setItem(key, JSON.stringify(records));
      }
      return true;
    } catch (error) {
      // Storage can be full or blocked (private browsing); the app keeps working in memory.
      return false;
    }
  }

  /* --------------------------------------------------------------- store -- */

  /**
   * Creates an expense store backed by a storage object (localStorage in the
   * browser, a plain object in the tests).
   */
  function createStore(storage, options) {
    var key = (options && options.key) || STORAGE_KEY;
    var expenses = readRecords(storage, key);

    function save() {
      writeRecords(storage, key, expenses);
    }

    return {
      key: key,

      all: function () {
        return expenses.slice();
      },

      total: function () {
        var sum = expenses.reduce(function (running, expense) {
          return running + expense.amount;
        }, 0);
        return roundToCents(sum);
      },

      add: function (input) {
        var result = validate(input);

        if (!result.ok) {
          return result;
        }

        var expense = {
          id: createId(),
          description: result.value.description,
          amount: result.value.amount,
          category: result.value.category,
          createdAt: new Date().toISOString()
        };

        expenses = expenses.concat([expense]);
        save();

        return { ok: true, expense: expense };
      },

      remove: function (id) {
        var removed = null;

        expenses = expenses.filter(function (expense) {
          if (expense.id === id) {
            removed = expense;
            return false;
          }
          return true;
        });

        if (removed) {
          save();
        }

        return removed;
      },

      reload: function () {
        expenses = readRecords(storage, key);
        return expenses.slice();
      }
    };
  }

  /* ------------------------------------------------------------------ ui -- */

  function init(doc, storage) {
    var form = doc.getElementById('expense-form');

    if (!form) {
      return null;
    }

    var descriptionInput = doc.getElementById('description');
    var amountInput = doc.getElementById('amount');
    var categoryInput = doc.getElementById('category');
    var listBody = doc.getElementById('expense-list');
    var table = doc.getElementById('expense-table');
    var emptyState = doc.getElementById('empty-state');
    var totalOutput = doc.getElementById('total-amount');
    var message = doc.getElementById('form-message');

    var fields = {
      description: descriptionInput,
      amount: amountInput,
      category: categoryInput
    };

    var errorTargets = {
      description: doc.getElementById('description-error'),
      amount: doc.getElementById('amount-error'),
      category: doc.getElementById('category-error')
    };

    var store = createStore(storage);

    CATEGORIES.forEach(function (category) {
      var option = doc.createElement('option');
      option.value = category;
      option.textContent = category;
      categoryInput.appendChild(option);
    });

    function clearFieldError(name) {
      if (errorTargets[name]) {
        errorTargets[name].textContent = '';
      }
      if (fields[name]) {
        fields[name].removeAttribute('aria-invalid');
      }
    }

    function clearErrors() {
      Object.keys(errorTargets).forEach(clearFieldError);
    }

    function showErrors(errors) {
      var firstInvalid = null;

      Object.keys(errors).forEach(function (name) {
        if (errorTargets[name]) {
          errorTargets[name].textContent = errors[name];
        }
        if (fields[name]) {
          fields[name].setAttribute('aria-invalid', 'true');
          if (!firstInvalid) {
            firstInvalid = fields[name];
          }
        }
      });

      if (firstInvalid && typeof firstInvalid.focus === 'function') {
        firstInvalid.focus();
      }
    }

    function buildRow(expense) {
      var row = doc.createElement('tr');

      var descriptionCell = doc.createElement('th');
      descriptionCell.setAttribute('scope', 'row');
      descriptionCell.textContent = expense.description;
      row.appendChild(descriptionCell);

      var categoryCell = doc.createElement('td');
      categoryCell.textContent = expense.category;
      row.appendChild(categoryCell);

      var amountCell = doc.createElement('td');
      amountCell.className = 'amount-column';
      amountCell.textContent = formatAmount(expense.amount);
      row.appendChild(amountCell);

      var actionCell = doc.createElement('td');
      actionCell.className = 'action-column';

      var deleteButton = doc.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-button';
      deleteButton.setAttribute('data-id', expense.id);
      deleteButton.setAttribute('aria-label', 'Delete ' + expense.description);
      deleteButton.textContent = 'Delete';

      actionCell.appendChild(deleteButton);
      row.appendChild(actionCell);

      return row;
    }

    function render() {
      var expenses = store.all().slice().reverse();

      listBody.textContent = '';

      expenses.forEach(function (expense) {
        listBody.appendChild(buildRow(expense));
      });

      table.hidden = expenses.length === 0;
      emptyState.hidden = expenses.length > 0;
      totalOutput.textContent = formatAmount(store.total());
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearErrors();

      var result = store.add({
        description: descriptionInput.value,
        amount: amountInput.value,
        category: categoryInput.value
      });

      if (!result.ok) {
        showErrors(result.errors);
        message.textContent = 'Nothing was added. Please fix the highlighted field.';
        return;
      }

      form.reset();
      render();
      message.textContent =
        'Added ' + result.expense.description + ' (' + formatAmount(result.expense.amount) + ').';
      descriptionInput.focus();
    });

    ['input', 'change'].forEach(function (eventName) {
      form.addEventListener(eventName, function (event) {
        var name = event.target && event.target.id;
        if (name && errorTargets[name]) {
          clearFieldError(name);
        }
      });
    });

    listBody.addEventListener('click', function (event) {
      var button = event.target;

      while (button && button.tagName !== 'BUTTON') {
        button = button.parentNode;
      }

      if (!button || !button.getAttribute('data-id')) {
        return;
      }

      var removed = store.remove(button.getAttribute('data-id'));

      if (removed) {
        render();
        message.textContent =
          'Deleted ' + removed.description + ' (' + formatAmount(removed.amount) + ').';
      }
    });

    render();

    return { store: store, render: render };
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    CATEGORIES: CATEGORIES,
    MAX_DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH,
    MAX_AMOUNT: MAX_AMOUNT,
    validate: validate,
    parseAmount: parseAmount,
    formatAmount: formatAmount,
    createStore: createStore,
    init: init
  };
});
