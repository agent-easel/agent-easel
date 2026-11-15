// macOS notifications through UNUserNotificationCenter, outside Electron's Notification
// presenter: Electron withdraws what it posted when the app quits, and any call into its
// presenter asks for permission. N-API is ABI-stable, so the module builds once against
// Node's headers and loads in Electron's main process. Built by scripts/stage.mjs (macOS only).
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>
#include <string>
#include <vector>

namespace {

// A completion handler's answer, carried to the JavaScript thread.
struct Answer {
  enum Kind { kNull, kString, kBoolean, kStrings };
  explicit Answer(Kind kind) : kind(kind) {}
  napi_deferred deferred = nullptr;
  Kind kind;
  std::string text;
  bool flag = false;
  std::vector<std::string> texts;
};

Answer* Text(const std::string& text) {
  auto* answer = new Answer(Answer::kString);
  answer->text = text;
  return answer;
}

napi_value Value(napi_env env, const Answer& answer) {
  napi_value value;
  switch (answer.kind) {
    case Answer::kNull:
      napi_get_null(env, &value);
      break;
    case Answer::kString:
      napi_create_string_utf8(env, answer.text.c_str(), answer.text.size(), &value);
      break;
    case Answer::kBoolean:
      napi_get_boolean(env, answer.flag, &value);
      break;
    case Answer::kStrings:
      napi_create_array_with_length(env, answer.texts.size(), &value);
      for (size_t i = 0; i < answer.texts.size(); i++) {
        napi_value item;
        napi_create_string_utf8(env, answer.texts[i].c_str(), answer.texts[i].size(), &item);
        napi_set_element(env, value, static_cast<uint32_t>(i), item);
      }
      break;
  }
  return value;
}

void ResolveOnJsThread(napi_env env, napi_value, void*, void* data) {
  auto* answer = static_cast<Answer*>(data);
  napi_resolve_deferred(env, answer->deferred, Value(env, *answer));
  delete answer;
}

// A promise and the thread-safe function that settles it from a completion handler.
struct Pending {
  napi_value promise;
  napi_deferred deferred;
  napi_threadsafe_function resolver;
};

Pending Promise(napi_env env, const char* name) {
  Pending pending;
  napi_create_promise(env, &pending.deferred, &pending.promise);
  napi_value resource;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource);
  napi_create_threadsafe_function(env, nullptr, nullptr, resource, 0, 1, nullptr, nullptr,
                                  nullptr, ResolveOnJsThread, &pending.resolver);
  return pending;
}

void Settle(const Pending& pending, Answer* answer) {
  answer->deferred = pending.deferred;
  napi_call_threadsafe_function(pending.resolver, answer, napi_tsfn_blocking);
  napi_release_threadsafe_function(pending.resolver, napi_tsfn_release);
}

std::string Utf8(NSString* value) { return value ? std::string(value.UTF8String) : std::string(); }

std::string StringArgument(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::string out(length, '\0');
  napi_get_value_string_utf8(env, value, out.data(), length + 1, &length);
  return out;
}

NSString* NS(const std::string& value) { return [NSString stringWithUTF8String:value.c_str()]; }

NSString* Status(UNAuthorizationStatus status) {
  switch (status) {
    case UNAuthorizationStatusNotDetermined: return @"notDetermined";
    case UNAuthorizationStatusDenied: return @"denied";
    case UNAuthorizationStatusAuthorized: return @"authorized";
    case UNAuthorizationStatusProvisional: return @"provisional";
    default: return @"unknown";
  }
}

// authorizationStatus(): Promise<"notDetermined" | "denied" | "authorized" | "provisional" | "unknown">
napi_value AuthorizationStatus(napi_env env, napi_callback_info) {
  Pending pending = Promise(env, "authorizationStatus");
  [[UNUserNotificationCenter currentNotificationCenter]
      getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings* settings) {
        Settle(pending, Text(Utf8(Status(settings.authorizationStatus))));
      }];
  return pending.promise;
}

// requestAuthorization(): Promise<boolean>. Alerts and badges only: Factory never plays sounds.
napi_value RequestAuthorization(napi_env env, napi_callback_info) {
  Pending pending = Promise(env, "requestAuthorization");
  [[UNUserNotificationCenter currentNotificationCenter]
      requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionBadge
                    completionHandler:^(BOOL granted, NSError*) {
                      auto* answer = new Answer(Answer::kBoolean);
                      answer->flag = granted;
                      Settle(pending, answer);
                    }];
  return pending.promise;
}

// post(id, title, body, threadId): Promise<string | null>, the refusal's message or null.
napi_value Post(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  UNMutableNotificationContent* content = [[UNMutableNotificationContent alloc] init];
  content.title = NS(StringArgument(env, argv[1]));
  content.body = NS(StringArgument(env, argv[2]));
  content.threadIdentifier = NS(StringArgument(env, argv[3]));
  content.sound = nil;
  UNNotificationRequest* request =
      [UNNotificationRequest requestWithIdentifier:NS(StringArgument(env, argv[0]))
                                           content:content
                                           trigger:nil];
  Pending pending = Promise(env, "post");
  [[UNUserNotificationCenter currentNotificationCenter]
      addNotificationRequest:request
       withCompletionHandler:^(NSError* error) {
         Settle(pending, error ? Text(Utf8(error.localizedDescription ?: @"Refused"))
                               : new Answer(Answer::kNull));
       }];
  return pending.promise;
}

// remove(ids: string[]): void, best effort, also for notifications of earlier processes.
napi_value Remove(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  uint32_t length = 0;
  napi_get_array_length(env, argv[0], &length);
  NSMutableArray* ids = [NSMutableArray arrayWithCapacity:length];
  for (uint32_t i = 0; i < length; i++) {
    napi_value item;
    napi_get_element(env, argv[0], i, &item);
    [ids addObject:NS(StringArgument(env, item))];
  }
  [[UNUserNotificationCenter currentNotificationCenter]
      removeDeliveredNotificationsWithIdentifiers:ids];
  return nullptr;
}

// delivered(): Promise<string[]>, the identifiers still in Notification Center.
napi_value Delivered(napi_env env, napi_callback_info) {
  Pending pending = Promise(env, "delivered");
  [[UNUserNotificationCenter currentNotificationCenter]
      getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification*>* notifications) {
        auto* answer = new Answer(Answer::kStrings);
        for (UNNotification* notification in notifications)
          answer->texts.push_back(Utf8(notification.request.identifier));
        Settle(pending, answer);
      }];
  return pending.promise;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"authorizationStatus", nullptr, AuthorizationStatus, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"requestAuthorization", nullptr, RequestAuthorization, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"post", nullptr, Post, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"remove", nullptr, Remove, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"delivered", nullptr, Delivered, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
