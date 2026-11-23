# Expense Tracker

A small web app for keeping track of what you spend. Add an expense with a
description, an amount and a category; see every expense in a table with a
running total; and delete any you no longer need. Invalid input (an empty
description, a negative or non-numeric amount, or no category) is caught with a
clear message instead of being added, and your expenses are saved in the
browser's local storage so they are still there after a reload.

## Files

- `index.html` - the page
- `styles.css` - the styles
- `app.js` - the app logic
- `package.json` - project metadata and the test script
- `tests/expense.test.js` - tests for the expense logic
- `tests/page.test.js` - checks on the page
- `.github/workflows/tests.yml` - runs the tests automatically

## How to open it

Open `index.html` in a browser. There is no build step and nothing to install.

## How to run the tests

```
npm install
npm test
```

The tests also run automatically in GitHub Actions on every push and every pull
request.
