#ifndef BASE64_HPP
#define BASE64_HPP

#include <string>

/**
 * @brief Encodes binary data to base64 string
 * 
 * @param bytes Pointer to the binary data
 * @param length Length of the binary data in bytes
 * @return std::string Base64 encoded string
 */
std::string base64_encode(const unsigned char* bytes, int length);

#endif // BASE64_HPP
