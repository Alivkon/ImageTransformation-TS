# International Site Migration Plan

## Goal

Create an international version of the current Russian-oriented site without
duplicating the whole project.

The international version should:

- use a foreign domain;
- have an English interface;
- allow registration with any email domain;
- keep the current payment details for now;
- share as much infrastructure and code as possible with the existing Russian
  version.

The Russian version should remain focused on the Russian audience and continue
to allow registration only with Russian email domains, for example `.ru`.

## Recommended Architecture

Do not create a full copy of the site as a separate codebase.

The better approach is:

- one codebase;
- two domain configurations;
- one deployment model that can distinguish the site variant by host/domain;
- one database at the initial stage;
- explicit separation of users by site region or source domain.

This avoids maintaining two diverging projects with separate bugs, migrations,
admin behavior, and frontend changes.

## Domains

Use two domains:

- Russian domain: current Russian site.
- International domain: new foreign domain, for example `.com`, `.io`, `.ai`,
  or another suitable international zone.

The application should detect the active site variant by request host:

- Russian domain -> Russian interface and Russian registration restrictions.
- International domain -> English interface and no email-domain restriction.

## Localization

Move user-facing text into localization files or a localization layer.

At minimum, localize:

- frontend interface text;
- validation messages;
- authentication and registration messages;
- payment-related labels and messages;
- email templates;
- SEO metadata;
- static legal or informational pages if they are visible to international
  users.

Suggested locales:

- `ru` for the Russian site;
- `en` for the international site.

The locale should be selected automatically from the domain configuration, not
from hardcoded conditions spread across the codebase.

## Database Decision

Use one shared database at the initial stage.

This is preferable because:

- the product is still the same service;
- payment details remain the same for now;
- user and admin logic can stay unified;
- migrations remain simpler;
- analytics and support are easier to manage;
- the international version can be launched faster.

However, the database must explicitly store which site variant each user belongs
to.

Add a field such as:

- `region`: `ru` or `global`;
- or `tenant`: `ru_site` or `global_site`;
- or `sourceDomain`: the domain used during registration.

The exact field name should follow the existing database style.

This allows:

- filtering users by site;
- applying different registration rules;
- separating analytics;
- migrating international users to a separate database later if needed.

## When to Use a Separate Database

Create a separate database only if one of these requirements appears:

- different legal entity for the international version;
- different payment provider or accounting flow;
- strict legal requirement to separate personal data;
- independent admin panel or support team;
- different product behavior or pricing model;
- need to isolate operational risk between Russian and international users;
- plans to sell, move, or host the international service separately.

Until then, a separate database adds unnecessary complexity.

## Registration Rules

Registration rules should be configurable per site variant.

Russian site:

- allow only Russian email domains, for example `.ru`;
- keep current Russian-oriented restrictions.

International site:

- allow any valid email domain;
- do not apply the Russian `.ru` restriction.

Avoid hardcoding this rule directly into registration logic. Prefer a
configuration object, for example:

```ts
{
  site: "ru",
  locale: "ru",
  allowedEmailTlds: ["ru"]
}
```

```ts
{
  site: "global",
  locale: "en",
  allowedEmailTlds: null
}
```

## Configuration Model

Introduce a site configuration layer.

Example fields:

- `siteId`: `ru` or `global`;
- `domain`;
- `locale`;
- `defaultCurrency`;
- `allowedEmailTlds`;
- `paymentProvider`;
- `legalPagesVariant`;
- `seoDefaults`.

The application should choose this configuration from the incoming request host.

## Deployment

Recommended deployment options:

1. Same application instance, multiple domains.
   - Simplest option.
   - Good if traffic is low or moderate.
   - The app selects site configuration by host.

2. Two containers from the same image, one database.
   - Better isolation at runtime.
   - Same code and same image.
   - Different environment variables per container.
   - Still avoids duplicated code.

Avoid creating a separate repository or manually copied codebase unless the
international product becomes truly independent.

## Implementation Steps

1. Register the international domain.
2. Add site configuration support for Russian and international domains.
3. Add localization support for `ru` and `en`.
4. Move frontend and backend user-facing strings into translation files.
5. Add a user field for region, tenant, or source domain.
6. Update registration logic to apply email restrictions from configuration.
7. Set Russian domain config to allow only `.ru` emails.
8. Set international domain config to allow all valid emails.
9. Translate frontend interface and public static pages into English.
10. Configure the international domain in reverse proxy / hosting.
11. Test registration, login, payment, generation, wallet, and admin flows from
    both domains.
12. Add analytics filters by region or source domain.

## Testing Checklist

Russian site:

- Russian interface is shown.
- Registration with `.ru` email works.
- Registration with non-`.ru` email is rejected.
- Existing users still work.
- Payments still work.

International site:

- English interface is shown.
- Registration with `.com`, `.gmail.com`, `.outlook.com`, and other domains
  works.
- Russian-only restrictions are not applied.
- Payments still use the current payment details.
- Users are marked as international/global in the database.

Shared behavior:

- Login works for existing users.
- Admin views can distinguish Russian and international users.
- Generation and wallet flows behave the same unless explicitly configured
  otherwise.
- Database migrations do not break existing production users.

## Final Recommendation

Build a multi-region version of the current site:

- one project;
- one codebase;
- one database for now;
- two domains;
- domain-based configuration;
- localized interface;
- configurable registration rules;
- database field for user source or region.

This gives the fastest practical launch path while keeping the option to split
the international service into a separate database or deployment later.
