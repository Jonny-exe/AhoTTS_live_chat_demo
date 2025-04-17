//
// Copyright (c) 2023 Olrea, Florian Dang
// This file is part of OpenAI C++ library.
//
// Licensed under the MIT License (the "License"); you may not use this file
// except in compliance with the License. You may obtain a copy of the License at
//
//      https://opensource.org/licenses/MIT
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

#ifndef OPENAI_HPP_
#define OPENAI_HPP_

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <curl/curl.h>
#include <functional>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "nlohmann/json.hpp"

#define OPENAI_IMPL_NS_BEGIN namespace openai { namespace _impl {
#define OPENAI_IMPL_NS_END   } }

OPENAI_IMPL_NS_BEGIN

inline std::string get_env(const char* name) {
#if defined(_MSC_VER)
    // Windows specific
    size_t size;
    char buffer[1024];
    getenv_s(&size, buffer, sizeof(buffer), name);
    if (size > 0) {
        return std::string(buffer, size - 1);
    }
    return {};
#else
    // POSIX specific
    const char* value = std::getenv(name);
    return value == nullptr ? std::string{} : std::string{value};
#endif
}

inline std::string get_env_else(const char* name, const std::string& default_value) {
    std::string value = get_env(name);
    return value.empty() ? default_value : value;
}

inline bool is_env_defined(const char* name) {
    return !get_env(name).empty();
}

inline std::string url_encode(const std::string& value) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        return {};
    }
    char* encoded = curl_easy_escape(curl, value.c_str(), static_cast<int>(value.length()));
    if (!encoded) {
        curl_easy_cleanup(curl);
        return {};
    }
    std::string result{encoded};
    curl_free(encoded);
    curl_easy_cleanup(curl);
    return result;
}

inline std::string url_decode(const std::string& value) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        return {};
    }
    int decoded_length = 0;
    char* decoded = curl_easy_unescape(curl, value.c_str(), static_cast<int>(value.length()), &decoded_length);
    if (!decoded) {
        curl_easy_cleanup(curl);
        return {};
    }
    std::string result{decoded, static_cast<size_t>(decoded_length)};
    curl_free(decoded);
    curl_easy_cleanup(curl);
    return result;
}

struct CaseInsensitiveCompare {
    bool operator()(const std::string& lhs, const std::string& rhs) const {
        return std::lexicographical_compare(
            lhs.begin(), lhs.end(), rhs.begin(), rhs.end(),
            [](char c1, char c2) { return std::tolower(c1) < std::tolower(c2); });
    }
};

using Headers = std::unordered_map<std::string, std::string>;

struct Response {
    int status_code;
    std::string text;
    Headers headers;
};

class CurlWrapper {
public:
    CurlWrapper() {
        curl_global_init(CURL_GLOBAL_ALL);
        curl_ = curl_easy_init();
    }

    ~CurlWrapper() {
        if (curl_) {
            curl_easy_cleanup(curl_);
        }
        curl_global_cleanup();
    }

    CurlWrapper(const CurlWrapper&) = delete;
    CurlWrapper& operator=(const CurlWrapper&) = delete;

    CurlWrapper(CurlWrapper&& other) noexcept : curl_(other.curl_) {
        other.curl_ = nullptr;
    }

    CurlWrapper& operator=(CurlWrapper&& other) noexcept {
        if (this != &other) {
            if (curl_) {
                curl_easy_cleanup(curl_);
            }
            curl_ = other.curl_;
            other.curl_ = nullptr;
        }
        return *this;
    }

    CURL* get() const {
        return curl_;
    }

private:
    CURL* curl_;
};

inline size_t write_callback(char* ptr, size_t size, size_t nmemb, void* userdata) {
    std::string* response = static_cast<std::string*>(userdata);
    size_t real_size = size * nmemb;
    response->append(ptr, real_size);
    return real_size;
}

inline size_t header_callback(char* buffer, size_t size, size_t nitems, void* userdata) {
    Headers* headers = static_cast<Headers*>(userdata);
    size_t real_size = size * nitems;
    std::string header(buffer, real_size);
    size_t pos = header.find(':');
    if (pos != std::string::npos) {
        std::string key = header.substr(0, pos);
        std::string value = header.substr(pos + 1);
        // Trim leading and trailing whitespace
        key.erase(0, key.find_first_not_of(" \t"));
        key.erase(key.find_last_not_of(" \t\r\n") + 1);
        value.erase(0, value.find_first_not_of(" \t"));
        value.erase(value.find_last_not_of(" \t\r\n") + 1);
        (*headers)[key] = value;
    }
    return real_size;
}

inline Response make_request(const std::string& method, const std::string& url,
                            const std::string& api_key, const std::string& organization,
                            const std::string& data = "", const Headers& headers = {},
                            bool throw_exception = true) {
    CurlWrapper curl_wrapper;
    CURL* curl = curl_wrapper.get();
    if (!curl) {
        if (throw_exception) {
            throw std::runtime_error("Failed to initialize curl");
        }
        return {-1, "Failed to initialize curl", {}};
    }

    std::string response_string;
    Headers response_headers;

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_string);
    curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, header_callback);
    curl_easy_setopt(curl, CURLOPT_HEADERDATA, &response_headers);

    struct curl_slist* curl_headers = nullptr;
    curl_headers = curl_slist_append(curl_headers, ("Authorization: Bearer " + api_key).c_str());
    if (!organization.empty()) {
        curl_headers = curl_slist_append(curl_headers, ("OpenAI-Organization: " + organization).c_str());
    }
    curl_headers = curl_slist_append(curl_headers, "Content-Type: application/json");
    for (const auto& header : headers) {
        curl_headers = curl_slist_append(curl_headers, (header.first + ": " + header.second).c_str());
    }
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, curl_headers);

    if (method == "POST") {
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, data.c_str());
    } else if (method == "GET") {
        curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    } else if (method == "PUT") {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, data.c_str());
    } else if (method == "DELETE") {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
    } else {
        curl_slist_free_all(curl_headers);
        if (throw_exception) {
            throw std::runtime_error("Unsupported HTTP method: " + method);
        }
        return {-1, "Unsupported HTTP method: " + method, {}};
    }

    CURLcode res = curl_easy_perform(curl);
    long status_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status_code);
    curl_slist_free_all(curl_headers);

    if (res != CURLE_OK) {
        if (throw_exception) {
            throw std::runtime_error("curl_easy_perform() failed: " + std::string(curl_easy_strerror(res)));
        }
        return {static_cast<int>(status_code), "curl_easy_perform() failed: " + std::string(curl_easy_strerror(res)), response_headers};
    }

    return {static_cast<int>(status_code), response_string, response_headers};
}

OPENAI_IMPL_NS_END

namespace openai {

using Json = nlohmann::json;

inline Json json_parse(const std::string& str) {
    return Json::parse(str);
}

inline std::string json_dump(const Json& json) {
    return json.dump();
}

class OpenAI;

class Model {
public:
    Model(OpenAI& openai) : openai_(openai) {}

    Json list();
    Json retrieve(const std::string& model);

private:
    OpenAI& openai_;
};

class Completion {
public:
    Completion(OpenAI& openai) : openai_(openai) {}

    Json create(const Json& params);

private:
    OpenAI& openai_;
};

class Edit {
public:
    Edit(OpenAI& openai) : openai_(openai) {}

    Json create(const Json& params);

private:
    OpenAI& openai_;
};

class Image {
public:
    Image(OpenAI& openai) : openai_(openai) {}

    Json create(const Json& params);
    Json edit(const Json& params);
    Json variation(const Json& params);

private:
    OpenAI& openai_;
};

class Embedding {
public:
    Embedding(OpenAI& openai) : openai_(openai) {}

    Json create(const Json& params);

private:
    OpenAI& openai_;
};

class File {
public:
    File(OpenAI& openai) : openai_(openai) {}

    Json list();
    Json upload(const std::string& file, const std::string& purpose);
    Json retrieve(const std::string& file_id);
    Json content(const std::string& file_id);
    Json remove(const std::string& file_id);

private:
    OpenAI& openai_;
};

class FineTune {
public:
    FineTune(OpenAI& openai) : openai_(openai) {}

    Json create(const Json& params);
    Json list();
    Json retrieve(const std::string& fine_tune_id);
    Json cancel(const std::string& fine_tune_id);
    Json events(const std::string& fine_tune_id);
    Json remove(const std::string& model);

private:
    OpenAI& openai_;
};

class Chat {
public:
    Chat(OpenAI& openai) : openai_(openai) {}

    Json create(const Json& params);

private:
    OpenAI& openai_;
};

class Audio {
public:
    Audio(OpenAI& openai) : openai_(openai) {}

    Json transcribe(const Json& params);
    Json translate(const Json& params);

private:
    OpenAI& openai_;
};

class Moderation {
public:
    Moderation(OpenAI& openai) : openai_(openai) {}

    Json create(const Json& params);

private:
    OpenAI& openai_;
};

class OpenAI {
public:
    OpenAI() : api_key_(_impl::get_env("OPENAI_API_KEY")), organization_(_impl::get_env("OPENAI_ORGANIZATION")),
               model(*this), completion(*this), edit(*this), image(*this), embedding(*this),
               file(*this), fine_tune(*this), chat(*this), audio(*this), moderation(*this) {}

    OpenAI(const std::string& api_key, const std::string& organization = "")
        : api_key_(api_key), organization_(organization),
          model(*this), completion(*this), edit(*this), image(*this), embedding(*this),
          file(*this), fine_tune(*this), chat(*this), audio(*this), moderation(*this) {}

    void set_api_key(const std::string& api_key) {
        api_key_ = api_key;
    }

    void set_organization(const std::string& organization) {
        organization_ = organization;
    }

    void set_throw_exception(bool throw_exception) {
        throw_exception_ = throw_exception;
    }

    std::string get_api_key() const {
        return api_key_;
    }

    std::string get_organization() const {
        return organization_;
    }

    bool get_throw_exception() const {
        return throw_exception_;
    }

    Json post(const std::string& path, const Json& payload) {
        std::string url = "https://api.openai.com/v1" + path;
        std::string data = payload.dump();
#ifdef OPENAI_VERBOSE_OUTPUT
        std::cout << ">> request: " << url << "  " << data << std::endl;
#endif
        _impl::Response response = _impl::make_request("POST", url, api_key_, organization_, data, {}, throw_exception_);
        if (response.status_code < 200 || response.status_code >= 300) {
            if (throw_exception_) {
                throw std::runtime_error("HTTP error " + std::to_string(response.status_code) + ": " + response.text);
            } else {
                std::cerr << "Warning: HTTP error " << response.status_code << ": " << response.text << std::endl;
                return Json();
            }
        }
        return json_parse(response.text);
    }

    Json get(const std::string& path) {
        std::string url = "https://api.openai.com/v1" + path;
#ifdef OPENAI_VERBOSE_OUTPUT
        std::cout << ">> request: " << url << std::endl;
#endif
        _impl::Response response = _impl::make_request("GET", url, api_key_, organization_, "", {}, throw_exception_);
        if (response.status_code < 200 || response.status_code >= 300) {
            if (throw_exception_) {
                throw std::runtime_error("HTTP error " + std::to_string(response.status_code) + ": " + response.text);
            } else {
                std::cerr << "Warning: HTTP error " << response.status_code << ": " << response.text << std::endl;
                return Json();
            }
        }
        return json_parse(response.text);
    }

    Json delete_req(const std::string& path) {
        std::string url = "https://api.openai.com/v1" + path;
#ifdef OPENAI_VERBOSE_OUTPUT
        std::cout << ">> request: " << url << std::endl;
#endif
        _impl::Response response = _impl::make_request("DELETE", url, api_key_, organization_, "", {}, throw_exception_);
        if (response.status_code < 200 || response.status_code >= 300) {
            if (throw_exception_) {
                throw std::runtime_error("HTTP error " + std::to_string(response.status_code) + ": " + response.text);
            } else {
                std::cerr << "Warning: HTTP error " << response.status_code << ": " << response.text << std::endl;
                return Json();
            }
        }
        return json_parse(response.text);
    }

    Model model;
    Completion completion;
    Edit edit;
    Image image;
    Embedding embedding;
    File file;
    FineTune fine_tune;
    Chat chat;
    Audio audio;
    Moderation moderation;

private:
    std::string api_key_;
    std::string organization_;
    bool throw_exception_ = true;
};

// Implementations

inline Json Model::list() {
    return openai_.get("/models");
}

inline Json Model::retrieve(const std::string& model) {
    return openai_.get("/models/" + model);
}

inline Json Completion::create(const Json& params) {
    return openai_.post("/completions", params);
}

inline Json Edit::create(const Json& params) {
    return openai_.post("/edits", params);
}

inline Json Image::create(const Json& params) {
    return openai_.post("/images/generations", params);
}

inline Json Image::edit(const Json& params) {
    return openai_.post("/images/edits", params);
}

inline Json Image::variation(const Json& params) {
    return openai_.post("/images/variations", params);
}

inline Json Embedding::create(const Json& params) {
    return openai_.post("/embeddings", params);
}

inline Json File::list() {
    return openai_.get("/files");
}

inline Json File::upload(const std::string& file, const std::string& purpose) {
    // TODO: Implement file upload
    throw std::runtime_error("File upload not implemented yet");
}

inline Json File::retrieve(const std::string& file_id) {
    return openai_.get("/files/" + file_id);
}

inline Json File::content(const std::string& file_id) {
    return openai_.get("/files/" + file_id + "/content");
}

inline Json File::remove(const std::string& file_id) {
    return openai_.delete_req("/files/" + file_id);
}

inline Json FineTune::create(const Json& params) {
    return openai_.post("/fine-tunes", params);
}

inline Json FineTune::list() {
    return openai_.get("/fine-tunes");
}

inline Json FineTune::retrieve(const std::string& fine_tune_id) {
    return openai_.get("/fine-tunes/" + fine_tune_id);
}

inline Json FineTune::cancel(const std::string& fine_tune_id) {
    return openai_.post("/fine-tunes/" + fine_tune_id + "/cancel", Json::object());
}

inline Json FineTune::events(const std::string& fine_tune_id) {
    return openai_.get("/fine-tunes/" + fine_tune_id + "/events");
}

inline Json FineTune::remove(const std::string& model) {
    return openai_.delete_req("/models/" + model);
}

inline Json Chat::create(const Json& params) {
    return openai_.post("/chat/completions", params);
}

inline Json Audio::transcribe(const Json& params) {
    return openai_.post("/audio/transcriptions", params);
}

inline Json Audio::translate(const Json& params) {
    return openai_.post("/audio/translations", params);
}

inline Json Moderation::create(const Json& params) {
    return openai_.post("/moderations", params);
}

// Free functions

inline OpenAI& instance() {
    static OpenAI instance;
    return instance;
}

inline OpenAI& start(const std::string& api_key = _impl::get_env("OPENAI_API_KEY"),
                    const std::string& organization = _impl::get_env("OPENAI_ORGANIZATION")) {
    OpenAI& openai = instance();
    openai.set_api_key(api_key);
    openai.set_organization(organization);
    return openai;
}

inline Model& model() {
    return instance().model;
}

inline Completion& completion() {
    return instance().completion;
}

inline Edit& edit() {
    return instance().edit;
}

inline Image& image() {
    return instance().image;
}

inline Embedding& embedding() {
    return instance().embedding;
}

inline File& file() {
    return instance().file;
}

inline FineTune& fine_tune() {
    return instance().fine_tune;
}

inline Chat& chat() {
    return instance().chat;
}

inline Audio& audio() {
    return instance().audio;
}

inline Moderation& moderation() {
    return instance().moderation;
}

} // namespace openai

// User-defined literals for JSON are already defined in nlohmann/json.hpp
// So we don't need to define them here

#endif // OPENAI_HPP_
