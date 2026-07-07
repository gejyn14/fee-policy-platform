package kr.fees.api;

import kr.fees.persistence.BindingRepository;
import kr.fees.persistence.BindingRow;
import kr.fees.persistence.HistoryRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 계좌 배정판·배정 이력 조회. */
@RestController
@RequestMapping("/api/accounts")
public class BindingController {

    private final BindingRepository bindings;
    private final HistoryRepository history;

    public BindingController(BindingRepository bindings, HistoryRepository history) {
        this.bindings = bindings;
        this.history = history;
    }

    @GetMapping("/{accountId}/bindings")
    public List<BindingRow> bindings(@PathVariable String accountId) {
        return bindings.findByAccount(accountId);
    }

    @GetMapping("/{accountId}/bindings/history")
    public List<HistoryRepository.HistoryRow> history(@PathVariable String accountId) {
        return history.findByAccount(accountId);
    }
}
