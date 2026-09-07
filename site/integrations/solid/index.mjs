import solid from '@solidjs/vite-plugin';

/** Solid 2 compiler and static renderer for the site's presentation components. */
export default function solidPages() {
  return {
    name: 'inferay-solid-2',
    hooks: {
      'astro:config:setup': ({ addRenderer, updateConfig }) => {
        addRenderer({ name: 'inferay-solid-2', serverEntrypoint: new URL('./server.mjs', import.meta.url).pathname });
        updateConfig({ vite: { plugins: [solid({ ssr: true })] } });
      },
    },
  };
}
