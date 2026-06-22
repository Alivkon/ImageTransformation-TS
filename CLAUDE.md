# ImageTransformationTGBot-TS

TypeScript-версия бота для трансформации изображений.

Вся сборка и запуск пакетов делаются через `yarn`:

```bash
yarn install
yarn build
yarn start
```
После каждого изменения кода, для перезапуска бота используй:

```bash
sudo docker compose build bot && docker compose up -d bot
```