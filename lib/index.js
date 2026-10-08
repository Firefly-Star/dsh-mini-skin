/**
 * Host half of dsh-mini-skin.
 *
 * This skin only injects a stylesheet in the browser, so the node side has no
 * services to provide and no static assets to route. It exists because a
 * composition row loads a package's main entry, and an empty `apply` is the
 * cheapest way to keep that row honest.
 */
export function apply() {}
