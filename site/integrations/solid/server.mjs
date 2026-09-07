import { renderToString } from '@solidjs/web';

export default {
  name: 'inferay-solid-2',
  check(Component) { return typeof Component === 'function' && !Component.isAstroComponentFactory; },
  renderToStaticMarkup(Component, props) {
    return { html: renderToString(() => Component(props), { noScripts: true }) };
  },
};
