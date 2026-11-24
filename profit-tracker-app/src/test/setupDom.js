// jsdom has no layout, so it leaves out Element.scrollIntoView. Pages call it
// from timers (Schedule C "show records"), where the missing function became
// an unhandled error that failed the whole test run in CI even though every
// test passed. Real browsers always have it; tests only need it to exist.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
