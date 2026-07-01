# План реализации: новые примеры + переход в генерацию с готовым промтом

## Что уже есть в проекте

- Страница `Примеры` сейчас размечена статически в [frontend/index.html](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/index.html:308).
- Логика этой страницы в [frontend/src/pages/gallery.ts](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/src/pages/gallery.ts:1) сейчас отвечает только за compare-overlay и галерею пользовательских генераций.
- Страница генерации в [frontend/src/pages/generate.ts](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/src/pages/generate.ts:1) заполняет поле `#prompt-input` только вручную или через `.suggestion-btn`.
- Vite раздает статические файлы из `frontend/public/`, значит новые изображения примеров нужно перенести туда, а не читать из `temp/` в рантайме.

## Подтвержденные исходные данные

- В `temp/` есть 14 папок с кейсами, каждая содержит `before|befor` и `after` изображение.
- В `temp/promts.xls` есть таблица, где:
  - столбец `C` содержит название кейса;
  - столбец `E` содержит текст промта;
  - часть названий совпадает с папками не посимвольно, а после нормализации тире:
    - `Аниме-версия тебя - для аватара и мерча` в папке и `Аниме-версия тебя — для аватара и мерча` в `xls`;
    - `Идеальное общее фото - все смотрят и улыбаются` в папке и `Идеальное общее фото — все смотрят и улыбаются` в `xls`;
    - `Мода прошлого — в ярких красках` и `Яркие 80-е — цвета снова живые` уже используют длинное тире.
- В текущем `frontend/index.html` часть старых карточек указывает на отсутствующие файлы `case10/11/13`, значит блок примеров сейчас уже частично неконсистентен и его лучше перевести на единый источник данных.

## Целевое решение

- Все изображения примеров хранятся в проекте, например в `frontend/public/images/examples/<slug>/`.
- Все промты хранятся в проекте в явном виде, без зависимости от `xls` в рантайме.
- Страница `Примеры` строится из структуры данных, а не из вручную вставленного HTML.
- У каждой карточки есть:
  - before/after блок;
  - подпись из названия папки;
  - кнопка `Посмотреть промт`.
- Кнопка переводит пользователя на страницу генерации и подставляет соответствующий промт в `#prompt-input`.

## Рекомендуемая структура данных

- Добавить файл `frontend/src/data/example-prompts.ts`.
- В нем хранить массив объектов вида:

```ts
export interface ExampleCase {
  id: string;
  title: string;
  beforeImage: string;
  afterImage: string;
  prompt: string;
}
```

- `id` лучше сделать slug-ом, например `vozvrashchaem-zhizn-starym-snimkam`.
- `title` брать из названия папки, которое должно отображаться под карточкой.
- `prompt` перенести из столбца `E` файла `promts.xls`.

## План работ

### 1. Миграция файлов из `temp/` в проект

- Создать каталог `frontend/public/images/examples/`.
- Для каждой папки из `temp/` создать подкаталог по slug-имени.
- Перенести туда пары изображений, унифицировав названия файлов:
  - `before.jpg|png`
  - `after.jpg|png`
- Исправить разнобой `before` / `befor` только при переносе, чтобы в проекте был единый формат.
- `temp/` после миграции больше не использовать как источник фронтенд-данных.

### 2. Миграция промтов из `promts.xls`

- Один раз извлечь данные из `temp/promts.xls`.
- Сопоставить папки с записями по названию из столбца `C`.
- Для сопоставления использовать нормализацию:
  - trim;
  - приведение `-`, `—`, `–` к одному символу;
  - схлопывание двойных пробелов.
- Перенести тексты из столбца `E` в `frontend/src/data/example-prompts.ts`.
- `xls` не использовать в приложении и не делать его частью runtime-логики.

### 3. Перевод страницы `Примеры` на данные из кода

- Убрать захардкоженный набор карточек из [frontend/index.html](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/index.html:313).
- Оставить контейнер вида `#example-cases-grid` или использовать существующий `.gallery-cases`.
- В [frontend/src/pages/gallery.ts](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/src/pages/gallery.ts:1) добавить функцию рендера карточек из массива `ExampleCase[]`.
- Compare-overlay оставить существующим: карточка по-прежнему должна открываться в режиме before/after.

### 4. Кнопка `Посмотреть промт`

- В шаблон карточки добавить кнопку:

```html
<button class="btn btn-secondary btn-sm example-prompt-btn">Посмотреть промт</button>
```

- На кнопку повесить отдельный обработчик, чтобы:
  - не открывался compare-overlay по тому же клику;
  - сохранялся выбранный промт;
  - выполнялся переход на страницу `generate`.

### 5. Передача промта на страницу генерации

- Самый простой и надежный вариант для текущей архитектуры без роутера:
  - хранить выбранный промт во временном клиентском состоянии, например `sessionStorage`;
  - ключ вида `selected_example_prompt`.
- При нажатии `Посмотреть промт`:
  - записать промт в `sessionStorage`;
  - вызвать `navigate("generate")`.
- В [frontend/src/pages/generate.ts](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/src/pages/generate.ts:18) при инициализации:
  - прочитать `selected_example_prompt`;
  - если значение есть, заполнить `#prompt-input`;
  - вызвать `updateGenerateBtn()`;
  - удалить ключ из `sessionStorage`, чтобы промт не подставлялся повторно без явного действия пользователя.

## Файлы, которые вероятнее всего придется менять

- [frontend/index.html](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/index.html:308)
- [frontend/src/pages/gallery.ts](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/src/pages/gallery.ts:1)
- [frontend/src/pages/generate.ts](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/src/pages/generate.ts:1)
- `frontend/src/data/example-prompts.ts` — новый файл
- `frontend/public/images/examples/*` — новые ассеты
- Возможно CSS:
  - [frontend/css/components.css](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/css/components.css:441)
  - [frontend/css/layout.css](/home/alivkon/projects/RitualHUB/ImageTransformationTGBot-TS/frontend/css/layout.css:822)

## Проверки после реализации

- На странице `Примеры` отображаются все 14 новых кейсов.
- У каждой карточки корректно грузятся `before` и `after`.
- Подпись совпадает с названием папки, а не с названием из `xls`, если между ними есть разница в тире.
- По клику на карточку открывается compare-overlay.
- По клику на `Посмотреть промт` overlay не открывается.
- Пользователь попадает на страницу генерации.
- Поле промта автоматически заполняется нужным текстом из бывшего столбца `E`.
- После ручного редактирования пользователь может отправить генерацию без побочных эффектов.
- Сборка фронтенда проходит без битых ссылок на старые `case10/11/13`.

## Риски и замечания

- Нужна аккуратная нормализация названий: совпадение по строке без обработки тире даст ложные пропуски.
- В `promts.xls` есть записи, для которых сейчас нет папок в `temp/`; их не нужно рендерить без изображений.
- В папках встречаются разные расширения и опечатка `befor`; это надо стандартизировать при переносе.
- Если потребуется SEO-индексация готовых примеров как полноценные ссылки, позже можно заменить `sessionStorage` на query-параметр, но для текущей SPA-структуры это не обязательно.

## Предлагаемый порядок выполнения

1. Перенести изображения из `temp/` в `frontend/public/images/examples/`.
2. Создать `frontend/src/data/example-prompts.ts` и занести туда 14 кейсов с промтами.
3. Перевести HTML блока примеров на рендер из данных.
4. Добавить кнопку `Посмотреть промт`.
5. Реализовать передачу промта через `sessionStorage` и автозаполнение в `generate`.
6. Собрать фронтенд и вручную проверить сценарии.
