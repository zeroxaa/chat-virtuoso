/**
 * Open-source drop-in for `@virtuoso.dev/message-list`. Import from here exactly
 * as you would from the commercial package — the surface is identical, only the
 * implementation differs (backed by MIT-licensed react-virtuoso). If a consumer
 * needs something the commercial API has and ours lacks, add it HERE; never
 * adapt the consumer.
 */
export {
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  useVirtuosoMethods,
  useVirtuosoLocation,
} from './VirtuosoMessageList';
export type {
  VirtuosoMessageListProps,
  VirtuosoMessageListMethods,
  VirtuosoMessageListData,
  ItemContentProps,
  ListScrollLocation,
  ScrollLocationWithAlign,
  DataWithScrollModifier,
  AutoScrollControl,
  VirtuosoScrollBehavior,
} from './VirtuosoMessageList';
