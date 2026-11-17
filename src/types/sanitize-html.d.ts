declare module 'sanitize-html' {
  interface Options {
    [key: string]: any;
    transformTags?: Record<string, (tagName: string, attributes: Record<string, string>) => { tagName: string; attribs: Record<string, string> }>;
  }
  function sanitizeHtml(value: string, options?: Options): string;
  export default sanitizeHtml;
}
