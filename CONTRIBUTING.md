# Contributing

Open an [issue](https://github.com/unmap-dev/trail-explorer/issues) for a bug or proposal, or
submit a focused pull request with a description of what changes and how you verified it. Use
Node.js 24 and pnpm 10.29.3, install with `pnpm install --frozen-lockfile`, and run `pnpm check`
before submitting. `pnpm check` needs no API key: without one the app shows how to get one.

This is an automatic public export of one of the Unmap demos. The product monorepo is the
authoritative source, including production deployment at apps.unmap.dev. Maintainers apply
accepted pull requests upstream and export them back here; the `sync-source` workflow pulls each
verified snapshot hourly. Please do not edit the generated lockfile by hand.

The files in `components/ui/`, `lib/map-*` and `lib/kit/` are copied from the
[Unmap component registry](https://registry.unmap.dev) and the shared demo kit. Here they are
ordinary source; a fix to one of them is applied to its upstream source and arrives in the next
snapshot.

Do not include API keys in contributions. Report credential exposure through GitHub's private
vulnerability reporting for this repository.
