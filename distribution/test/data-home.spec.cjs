const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  resolveSeekmoreDataHome,
} = require('../dist/main/seekmore-data-home.js');

function fakeApp(paths) {
  return {
    getPath(name) {
      if (!(name in paths)) throw new Error(`Unexpected Electron path request: ${name}`);
      return paths[name];
    },
  };
}

test('macOS keeps the existing Electron userData directory unchanged', () => {
  const app = fakeApp({
    userData: '/Users/test/Library/Application Support/SEEKMORE',
    home: '/Users/test',
  });

  assert.equal(
    resolveSeekmoreDataHome(app, 'darwin', {}),
    '/Users/test/Library/Application Support/SEEKMORE',
  );
});

test('Windows stores SEEKMORE mutable runtime data under LOCALAPPDATA', () => {
  const app = fakeApp({
    userData: 'C:\\Users\\test\\AppData\\Roaming\\SEEKMORE',
    home: 'C:\\Users\\test',
  });

  assert.equal(
    resolveSeekmoreDataHome(
      app,
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
    ),
    path.win32.join('C:\\Users\\test\\AppData\\Local', 'SEEKMORE'),
  );
});

test('Windows has a deterministic home fallback when LOCALAPPDATA is unavailable', () => {
  const app = fakeApp({
    userData: 'ignored',
    home: 'C:\\Users\\test',
  });

  assert.equal(
    resolveSeekmoreDataHome(app, 'win32', {}),
    path.win32.join('C:\\Users\\test', 'AppData', 'Local', 'SEEKMORE'),
  );
});
