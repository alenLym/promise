'use strict';

var Promise = require('./core');

var DEFAULT_WHITELIST = [
  ReferenceError,
  TypeError,
  RangeError
];

var enabled = false;
exports.disable = disable;
function disable() {
  enabled = false;
  Promise._onHandle = null;
  Promise._onReject = null;
}

exports.enable = enable;
function enable(options) {
  options = options || {};
  if (enabled) disable();
  enabled = true;
  var id = 0;
  var displayId = 0;
  var rejections = {};
  /**
   * 通过检查 Promise 是否已被记录并执行必要的操作来处理 Promise 拒绝。
   * @param {Promise} promise - 要处理的 promise 对象
   * @returns 无
   */
  Promise._onHandle = function (promise) {
    if (
      promise._state === 2 && // IS REJECTED
      rejections[promise._rejectionId]
    ) {
      if (rejections[promise._rejectionId].logged) {
        onHandled(promise._rejectionId);
      } else {
        clearTimeout(rejections[promise._rejectionId].timeout);
      }
      delete rejections[promise._rejectionId];
    }
  };
  /**
   * 通过存储错误并设置处理错误的 timeout 来处理 Promise 的拒绝。
   * @param {Promise} promise - 被拒绝的 Promise。
   * @param {Error} err - 导致拒绝的错误。
   * @returns 无
   */
  Promise._onReject = function (promise, err) {
    if (promise._deferredState === 0) { // not yet handled
      promise._rejectionId = id++;
      rejections[promise._rejectionId] = {
        displayId: null,
        error: err,
        timeout: setTimeout(
          onUnhandled.bind(null, promise._rejectionId),
          // For reference errors and type errors, this almost always
          // means the programmer made a mistake, so log them after just
          // 100ms
          // otherwise, wait 2 seconds to see if they get handled
          matchWhitelist(err, DEFAULT_WHITELIST)
            ? 100
            : 2000
        ),
        logged: false
      };
    }
  };
  /**
   * 根据提供的选项处理未处理的 Promise 拒绝。
   * @param {number} id - 未处理的 Promise 拒绝的 ID。
   * @returns 无
   */
  function onUnhandled(id) {
    if (
      options.allRejections ||
      matchWhitelist(
        rejections[id].error,
        options.whitelist || DEFAULT_WHITELIST
      )
    ) {
      rejections[id].displayId = displayId++;
      if (options.onUnhandled) {
        rejections[id].logged = true;
        options.onUnhandled(
          rejections[id].displayId,
          rejections[id].error
        );
      } else {
        rejections[id].logged = true;
        logError(
          rejections[id].displayId,
          rejections[id].error
        );
      }
    }
  }
  /**
   * 处理具有给定 id 的 promise 拒绝。
   * 如果已记录拒绝，它将使用拒绝详细信息调用 onHandled 回调函数。
   * 如果未提供 onHandled 回调，则会记录一条警告消息。
   * @param {number} id - 承诺拒绝的 ID。
   * @returns 无
   */
  function onHandled(id) {
    if (rejections[id].logged) {
      if (options.onHandled) {
        options.onHandled(rejections[id].displayId, rejections[id].error);
      } else if (!rejections[id].onUnhandled) {
        console.warn(
          'Promise Rejection Handled (id: ' + rejections[id].displayId + '):'
        );
        console.warn(
          '  This means you can ignore any previous messages of the form "Possible Unhandled Promise Rejection" with id ' +
          rejections[id].displayId + '.'
        );
      }
    }
  }
}

function logError(id, error) {
  console.warn('Possible Unhandled Promise Rejection (id: ' + id + '):');
  var errStr = (error && (error.stack || error)) + '';
  errStr.split('\n').forEach(function (line) {
    console.warn('  ' + line);
  });
}

function matchWhitelist(error, list) {
  return list.some(function (cls) {
    return error instanceof cls;
  });
}