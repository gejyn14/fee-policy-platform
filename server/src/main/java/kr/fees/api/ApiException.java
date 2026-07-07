package kr.fees.api;

import org.springframework.http.HttpStatus;

/** 도메인/검증 실패를 HTTP 상태 + 상세로 표현. 상세(detail)는 problem+json 바디에 담긴다. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final Object detail;

    public ApiException(HttpStatus status, String message, Object detail) {
        super(message);
        this.status = status;
        this.detail = detail;
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, message, null);
    }

    public static ApiException badRequest(String message, Object detail) {
        return new ApiException(HttpStatus.BAD_REQUEST, message, detail);
    }

    public HttpStatus status() {
        return status;
    }

    public Object detail() {
        return detail;
    }
}
